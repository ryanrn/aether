import type { ConnectionProvider } from "@aether/db";
import {
  atualizarTokens,
  desconectar,
  guardarConexao,
  segredos,
} from "./armazenamento";
import { spotifyProvedor } from "./spotify";
import { steamProvedor } from "./steam";
import { twitchProvedor } from "./twitch";
import { assinarStateDeConexao, verificarStateDeConexao } from "./state";
import {
  AutorizacaoInvalida,
  ProvedorNaoConfigurado,
  type AtividadeExterna,
  type Provedor,
} from "./tipos";

/**
 * O registro de provedores e o passo a passo que vale para todos.
 *
 * POR QUE ISTO EXISTE: o que era codigo do Spotify espalhado (rota de
 * conectar, rota de callback, modulo de conta, poller) vira UM caminho que
 * todo provedor percorre. Somar Twitch, Steam ou Riot passa a ser escrever um
 * adaptador e por uma linha em `PROVEDORES` — sem rota nova, sem tabela nova,
 * sem repetir a verificacao do `state`.
 *
 * E ISSO IMPORTA MAIS PELA SEGURANCA DO QUE PELA REPETICAO: a checagem do
 * `state` mora AQUI. Um provedor novo nao tem como esquecer dela, porque nao
 * e ele quem a faz.
 */

/**
 * `null` = provedor previsto, mas ainda nao implementado.
 *
 * Escrito e nao insinuado: a tela consegue dizer "ainda nao disponivel" em vez
 * de mostrar um botao que nao responde.
 */
const PROVEDORES: Record<ConnectionProvider, Provedor | null> = {
  SPOTIFY: spotifyProvedor,
  STEAM: steamProvedor,
  TWITCH: twitchProvedor,
  RIOT: null,
};

export function provedor(id: ConnectionProvider): Provedor | null {
  return PROVEDORES[id] ?? null;
}

/** Implementado E com segredos no ambiente. */
export function provedorDisponivel(id: ConnectionProvider): boolean {
  const p = provedor(id);
  return p !== null && p.configurado();
}

/** Os que a tela pode oferecer agora. */
export function provedoresDisponiveis(): {
  id: ConnectionProvider;
  nome: string;
}[] {
  return Object.values(PROVEDORES)
    .filter((p): p is Provedor => p !== null && p.configurado())
    .map((p) => ({ id: p.id, nome: p.nome }));
}

/**
 * TODOS os provedores previstos, com o estado de cada um.
 *
 * A tela de Conexoes usa isto para tres coisas: listar o que da para conectar
 * agora, e dizer "ainda nao disponivel" para o resto SEM inventar um botao que
 * nao responde. `implementado` sem `configurado` = codigo pronto, faltam os
 * segredos no ambiente.
 */
export function provedoresConhecidos(): {
  id: ConnectionProvider;
  nome: string;
  implementado: boolean;
  configurado: boolean;
  /** o provedor produz atividade ao vivo (Spotify), ou e so um cracha (Riot)? */
  temAtividade: boolean;
}[] {
  return (
    Object.keys(PROVEDORES) as ConnectionProvider[]
  ).map((id) => {
    const p = PROVEDORES[id];
    return {
      id,
      nome: p?.nome ?? nomePadrao(id),
      implementado: p !== null,
      configurado: p?.configurado() ?? false,
      temAtividade: p?.lerAtividade != null,
    };
  });
}

/** Nome de exibicao para um provedor ainda sem adaptador. */
function nomePadrao(id: ConnectionProvider): string {
  const mapa: Record<ConnectionProvider, string> = {
    SPOTIFY: "Spotify",
    STEAM: "Steam",
    TWITCH: "Twitch",
    RIOT: "Riot Games",
  };
  return mapa[id];
}

/**
 * Comeca um login: devolve para onde mandar o navegador.
 *
 * O `state` sai daqui ja amarrado ao par (usuario, provedor) — ver `state.ts`.
 */
export async function iniciarLogin(
  userId: string,
  id: ConnectionProvider,
  redirectUri: string,
): Promise<string> {
  const p = provedor(id);
  if (!p || !p.configurado()) throw new ProvedorNaoConfigurado(id);
  const state = await assinarStateDeConexao(userId, id);
  return p.urlDeLogin(redirectUri, state);
}

export class StateInvalido extends Error {
  constructor() {
    super("O `state` do login nao confere.");
    this.name = "StateInvalido";
  }
}

/**
 * Conclui um login e guarda a conexao.
 *
 * A VERIFICACAO DO `state` E AQUI, nao na rota. Sao tres condicoes, e as tres
 * precisam bater:
 *
 *  1. o `state` e nosso e nao venceu;
 *  2. ele foi emitido para o provedor que esta respondendo — senao um `state`
 *     de um servico serviria de entrada no callback de outro;
 *  3. ele pertence a quem esta logado AGORA — senao alguem faz voce concluir
 *     um login que amarra a conta DELE na SUA (confused deputy), e a partir
 *     dai o perfil dele aparece como seu.
 */
export async function concluirLogin(params: {
  /** o usuario da sessao ATUAL, lido do cookie pela rota */
  sessionUserId: string;
  provider: ConnectionProvider;
  parametros: URLSearchParams;
  redirectUri: string;
}): Promise<void> {
  const p = provedor(params.provider);
  if (!p || !p.configurado()) throw new ProvedorNaoConfigurado(params.provider);

  const state = params.parametros.get("state");
  if (!state) throw new StateInvalido();

  const lido = await verificarStateDeConexao(state);
  if (
    !lido ||
    lido.provider !== params.provider ||
    lido.userId !== params.sessionUserId
  ) {
    throw new StateInvalido();
  }

  const r = await p.concluirLogin(params.parametros, params.redirectUri);
  await guardarConexao({
    userId: params.sessionUserId,
    provider: params.provider,
    externalId: r.externalId,
    displayName: r.displayName,
    accessToken: r.accessToken,
    refreshToken: r.refreshToken,
    expiresAt: r.expiresAt,
    scope: r.scope,
  });
}

/** Renova 1 min antes de expirar — margem para a chamada seguinte nao vencer. */
const MARGEM_MS = 60_000;

/**
 * Um access token valido, renovando e persistindo se preciso.
 *
 * `null` quando: nunca conectou; o segredo esta ilegivel (o `AUTH_SECRET`
 * mudou — a `segredos` ja apaga a linha morta); o provedor nao usa token de
 * usuario; ou a pessoa revogou o acesso, e ai a conexao e apagada.
 *
 * ERRO DE REDE SOBE. Apagar a conexao de alguem porque a API do provedor
 * piscou seria trocar uma falha passageira por uma permanente.
 */
export async function tokenValido(
  userId: string,
  id: ConnectionProvider,
): Promise<string | null> {
  const p = provedor(id);
  if (!p) return null;

  const s = await segredos(userId, id);
  if (!s) return null;

  if (s.expiresAt && s.expiresAt.getTime() - MARGEM_MS > Date.now()) {
    return s.accessToken;
  }

  // Sem `renovar` (Steam) o token e o que e: se venceu, nao ha o que fazer.
  if (!p.renovar) return s.accessToken;
  if (!s.refreshToken) {
    await desconectar(userId, id);
    return null;
  }

  try {
    const novo = await p.renovar(s.refreshToken);
    await atualizarTokens(userId, id, novo);
    return novo.accessToken;
  } catch (erro) {
    if (erro instanceof AutorizacaoInvalida) {
      await desconectar(userId, id);
      return null;
    }
    throw erro;
  }
}

/**
 * O que a pessoa esta fazendo no servico, ou `null`.
 *
 * `null` tambem quando o provedor NAO TEM atividade — e o caso da Riot, cuja
 * conexao e so um cracha. Quem chama nao precisa saber quais tem e quais nao:
 * pergunta, e recebe `null`.
 */
export async function atividadeDaConexao(
  userId: string,
  id: ConnectionProvider,
): Promise<AtividadeExterna | null> {
  const p = provedor(id);
  if (!p?.lerAtividade) return null;

  const dados = await segredos(userId, id);
  if (!dados) return null;

  /**
   * So quem RENOVA passa pelo `tokenValido` — ele e que troca um token
   * vencido. Quem nao renova (Steam) usa o que estiver guardado, que pode
   * ser `null`, e le a atividade pelo `externalId` com a chave do aplicativo.
   */
  const accessToken = p.renovar ? await tokenValido(userId, id) : dados.accessToken;
  if (p.renovar && !accessToken) return null;

  try {
    return await p.lerAtividade({
      userId,
      externalId: dados.externalId,
      accessToken,
    });
  } catch (erro) {
    if (erro instanceof AutorizacaoInvalida) {
      await desconectar(userId, id);
      return null;
    }
    // Erro de rede sobe: quem chama tenta de novo no proximo ciclo.
    throw erro;
  }
}
