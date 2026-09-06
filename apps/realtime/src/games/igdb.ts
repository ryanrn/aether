import { log } from "@aether/shared/log";
import type { CandidatoIgdb } from "./normalize";

/**
 * Cliente do IGDB.
 *
 * O IGDB nao tem chave propria: autentica pela Twitch, com *client
 * credentials* — a aplicacao pega um token para ela mesma, sem login de
 * usuario nenhum. Nao ha fluxo de OAuth do usuario aqui, nao ha redirect, e
 * nao ha nada para o navegador fazer.
 *
 * SEGURANCA — as duas regras deste arquivo:
 *
 *  1. Este modulo roda no GATEWAY, nunca no Electron e nunca no navegador. O
 *     `TWITCH_CLIENT_SECRET` nao pode chegar perto do renderer: o app desktop
 *     carrega conteudo remoto, e segredo la e segredo publicado.
 *
 *  2. Quem consulta o IGDB e o nosso servidor, nao a maquina de quem joga.
 *     Assim o IGDB ve o IP de UM servidor, e nao "o IP do Ryan pediu Hollow
 *     Knight as 3 da manha" — que seria transformar deteccao local em rastro
 *     externo.
 *
 * Nenhuma funcao daqui lanca por falha de rede ou de credencial: devolvem
 * `null` e a atividade segue com o nome e o icone do executavel. Capa e
 * enfeite; o jogo aparecendo e o recurso.
 */

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const API_URL = "https://api.igdb.com/v4/games";

/** Nenhuma consulta pode pendurar o gateway. */
const TIMEOUT_MS = 6000;

/** O par e obrigatorio: metade da configuracao so falharia na hora da busca. */
function credenciais(): { id: string; secret: string } | null {
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { id, secret };
}

/** O IGDB esta configurado? Quem chama usa para nem tentar. */
export function igdbConfigurado(): boolean {
  return credenciais() !== null;
}

/**
 * Token em memoria.
 *
 * O da Twitch dura cerca de 60 dias, entao guardar em memoria basta e evita
 * mais uma tabela. Reiniciar o gateway pede um token novo — uma requisicao a
 * cada deploy, o que nao e nada.
 */
let tokenAtual: { valor: string; expiraEm: number } | null = null;

/** Margem para nao usar um token que vence no meio da requisicao. */
const MARGEM_MS = 60_000;

async function obterToken(forcarNovo = false): Promise<string | null> {
  const cred = credenciais();
  if (!cred) return null;

  if (
    !forcarNovo &&
    tokenAtual &&
    tokenAtual.expiraEm > Date.now() + MARGEM_MS
  ) {
    return tokenAtual.valor;
  }

  try {
    const corpo = new URLSearchParams({
      client_id: cred.id,
      client_secret: cred.secret,
      grant_type: "client_credentials",
    });
    const resposta = await fetch(`${TOKEN_URL}?${corpo.toString()}`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resposta.ok) {
      /**
       * O status entra no log; o corpo NAO. A resposta de erro da Twitch pode
       * repetir o que foi enviado, e o que foi enviado inclui o secret.
       */
      log.warn("gateway.igdb.token_recusado", "Twitch recusou o token do IGDB", {
        status: resposta.status,
      });
      return null;
    }

    const dados = (await resposta.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (typeof dados.access_token !== "string") return null;

    const duracao =
      typeof dados.expires_in === "number" ? dados.expires_in * 1000 : 3600_000;
    tokenAtual = { valor: dados.access_token, expiraEm: Date.now() + duracao };
    return tokenAtual.valor;
  } catch (erro) {
    log.warn("gateway.igdb.token_falhou", "não consegui token do IGDB", {
      err: erro,
    });
    return null;
  }
}

/**
 * Escapa aspas para a busca do IGDB.
 *
 * A linguagem de consulta do IGDB (APICalypse) delimita texto com aspas, e o
 * nome vem de um manifesto no disco de quem joga — dado de fora, portanto.
 * Sem isto, um jogo chamado `x"; where id = 1; //` mudaria a consulta.
 */
function textoSeguro(valor: string): string {
  return valor.replace(/["\\]/g, " ").replace(/[\r\n]/g, " ").slice(0, 100);
}

interface RespostaIgdb {
  id?: unknown;
  name?: unknown;
  cover?: { image_id?: unknown } | null;
  genres?: Array<{ name?: unknown }> | null;
}

/**
 * Busca por nome. Devolve os candidatos; quem decide qual serve e o
 * `melhorCasamento` — de proposito, para a escolha ser testavel sem rede.
 */
export async function buscarJogos(nome: string): Promise<CandidatoIgdb[]> {
  const token = await obterToken();
  const cred = credenciais();
  if (!token || !cred) return [];

  const consulta =
    `search "${textoSeguro(nome)}"; ` +
    "fields name,cover.image_id,genres.name; " +
    "limit 10;";

  async function chamar(comToken: string): Promise<Response | null> {
    try {
      return await fetch(API_URL, {
        method: "POST",
        headers: {
          "Client-ID": cred!.id,
          Authorization: `Bearer ${comToken}`,
          "Content-Type": "text/plain",
        },
        body: consulta,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (erro) {
      log.warn("gateway.igdb.busca_falhou", "busca no IGDB falhou", { err: erro });
      return null;
    }
  }

  let resposta = await chamar(token);

  /**
   * 401 significa token vencido ou revogado. Uma unica retentativa com token
   * novo — e so uma: se o segundo tambem falhar, o problema e a credencial, e
   * insistir viraria um par de requisicoes a cada jogo aberto.
   */
  if (resposta?.status === 401) {
    const novo = await obterToken(true);
    resposta = novo ? await chamar(novo) : null;
  }

  if (!resposta) return [];
  if (!resposta.ok) {
    log.warn("gateway.igdb.busca_status", "busca no IGDB respondeu erro", {
      status: resposta.status,
    });
    return [];
  }

  try {
    const dados = (await resposta.json()) as RespostaIgdb[];
    if (!Array.isArray(dados)) return [];
    return dados.flatMap((item) => {
      if (typeof item.id !== "number" || typeof item.name !== "string") {
        return [];
      }
      const imageId = item.cover?.image_id;
      const genero = item.genres?.[0]?.name;
      return [
        {
          id: item.id,
          name: item.name,
          coverImageId: typeof imageId === "string" ? imageId : null,
          genre: typeof genero === "string" ? genero : null,
        },
      ];
    });
  } catch {
    return [];
  }
}
