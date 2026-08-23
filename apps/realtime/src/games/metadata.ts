import { prisma } from "@aether/db";
import { buscarJogos, igdbConfigurado } from "./igdb";
import {
  CONFIANCA_PARA_RENOMEAR,
  melhorCasamento,
  normalizarNome,
  separarCamelCase,
  urlDaCapa,
} from "./normalize";

/**
 * Metadados de jogo: o que a atividade mostra alem do nome.
 *
 * A ORDEM importa e e o coracao desta camada:
 *
 *   1. cache no banco  (compartilhado entre todo mundo)
 *   2. IGDB            (so quando o cache nao tem, ou envelheceu)
 *   3. o que o detector ja deu (nome + icone do executavel)
 *
 * O passo 3 nunca falha, e por isso a atividade nunca fica quebrada: o IGDB e
 * um ENFEITE em cima de algo que ja funciona sozinho. Se ele estiver fora do
 * ar, sem credencial, devolvendo 429 ou simplesmente sem o jogo, a pessoa
 * continua aparecendo como "jogando X" com o icone do executavel.
 *
 * Quem chama NAO espera por isto. O gateway anuncia o jogo na hora e chama
 * aqui em segundo plano; quando a capa chega, anuncia de novo. Bloquear o
 * anuncio numa consulta externa faria a atividade de todo mundo depender da
 * latencia do IGDB.
 */

export interface MetadadosDeJogo {
  displayName: string;
  coverUrl: string | null;
  igdbId: number | null;
  genre: string | null;
}

/**
 * Quanto tempo uma linha vale antes de merecer nova consulta.
 *
 * Dois prazos, porque os dois casos sao diferentes: uma linha COM capa esta
 * resolvida e quase nunca muda; uma linha SEM capa pode ser um jogo que o
 * IGDB ainda nao tinha, ou uma indisponibilidade momentanea — merece nova
 * chance, mas nao a cada vez que alguem abre o jogo.
 */
const VALIDADE_COM_CAPA = 30 * 24 * 60 * 60 * 1000;
const VALIDADE_SEM_CAPA = 3 * 24 * 60 * 60 * 1000;

function estaVencida(linha: { coverUrl: string | null; checkedAt: Date }): boolean {
  const validade = linha.coverUrl ? VALIDADE_COM_CAPA : VALIDADE_SEM_CAPA;
  return Date.now() - linha.checkedAt.getTime() > validade;
}

/**
 * Consultas em voo, por chave.
 *
 * Sem isto, dez pessoas abrindo o mesmo jogo ao mesmo tempo dariam dez
 * consultas identicas ao IGDB — que limita a 4 por segundo. Com isto, a
 * primeira consulta e as outras nove esperam a mesma promessa.
 */
const emVoo = new Map<string, Promise<MetadadosDeJogo>>();

/**
 * Os metadados de um jogo pelo nome que o detector entregou.
 *
 * Sempre devolve algo utilizavel — no pior caso, o proprio nome detectado.
 */
export async function metadadosDe(nomeDetectado: string): Promise<MetadadosDeJogo> {
  const cru = String(nomeDetectado ?? "").trim();
  const chave = normalizarNome(cru);
  const semNada: MetadadosDeJogo = {
    displayName: cru,
    coverUrl: null,
    igdbId: null,
    genre: null,
  };
  if (chave.length === 0) return semNada;

  const jaEmVoo = emVoo.get(chave);
  if (jaEmVoo) return jaEmVoo;

  const promessa = resolver(chave, cru, semNada).finally(() => {
    emVoo.delete(chave);
  });
  emVoo.set(chave, promessa);
  return promessa;
}

async function resolver(
  chave: string,
  nomeDetectado: string,
  semNada: MetadadosDeJogo,
): Promise<MetadadosDeJogo> {
  // 1. cache
  let linha = null;
  try {
    linha = await prisma.gameMetadata.findUnique({ where: { lookupKey: chave } });
  } catch (erro) {
    // Banco fora: seguimos com o que o detector deu. Nunca derruba a atividade.
    console.error(
      "[metadata] leitura do cache falhou:",
      erro instanceof Error ? erro.message : "erro desconhecido",
    );
    return semNada;
  }

  if (linha && !estaVencida(linha)) {
    return {
      displayName: linha.displayName,
      coverUrl: linha.coverUrl,
      igdbId: linha.igdbId,
      genre: linha.genre,
    };
  }

  // 2. IGDB
  if (!igdbConfigurado()) {
    /**
     * Sem credencial nao gravamos nada. Gravar uma linha "DETECTOR" agora
     * faria o jogo ficar 3 dias sem nova tentativa DEPOIS de configurar as
     * chaves — o cache guardaria a ausencia de configuracao, e nao um fato
     * sobre o jogo.
     */
    return linha
      ? {
          displayName: linha.displayName,
          coverUrl: linha.coverUrl,
          igdbId: linha.igdbId,
          genre: linha.genre,
        }
      : semNada;
  }

  const candidatos = await buscarJogos(nomeDetectado);
  let casamento = melhorCasamento(nomeDetectado, candidatos);

  /**
   * Segunda tentativa quebrando CamelCase — para quando a leitura do
   * `appmanifest` falhou e sobrou o nome cru da pasta ("HollowKnight").
   * So vale a pena se a quebra mudou alguma coisa.
   */
  if (!casamento) {
    const separado = separarCamelCase(nomeDetectado);
    if (separado !== normalizarNome(nomeDetectado) && separado.length > 0) {
      const outros = await buscarJogos(separado);
      casamento = melhorCasamento(separado, outros);
    }
  }

  const capa = casamento ? urlDaCapa(casamento.candidato.coverImageId) : null;

  /**
   * O nome do IGDB so substitui o do detector com confianca alta. Abaixo
   * disso o nome da LOJA vale mais: ele veio do manifesto do jogo instalado,
   * que e a fonte mais autoritativa que existe sobre o que a pessoa abriu.
   */
  const displayName =
    casamento && casamento.confianca >= CONFIANCA_PARA_RENOMEAR
      ? casamento.candidato.name
      : nomeDetectado;

  const resultado: MetadadosDeJogo = {
    displayName,
    coverUrl: capa,
    igdbId: casamento?.candidato.id ?? null,
    genre: casamento?.candidato.genre ?? null,
  };

  /**
   * Grava inclusive quando NAO achou — cache negativo. Sem ele, um jogo que o
   * IGDB nao conhece geraria uma consulta a cada vez que alguem o abrisse,
   * para sempre. A validade menor (3 dias) e o que da nova chance quando o
   * IGDB cadastrar o jogo.
   */
  try {
    const dados = {
      detectedName: nomeDetectado,
      displayName: resultado.displayName,
      igdbId: resultado.igdbId,
      coverUrl: resultado.coverUrl,
      genre: resultado.genre,
      source: casamento ? ("IGDB" as const) : ("DETECTOR" as const),
      confidence: casamento?.confianca ?? null,
      checkedAt: new Date(),
    };
    await prisma.gameMetadata.upsert({
      where: { lookupKey: chave },
      update: dados,
      create: { lookupKey: chave, ...dados },
    });
  } catch (erro) {
    // Nao conseguir gravar o cache nao pode custar o resultado ja obtido.
    console.error(
      "[metadata] gravacao do cache falhou:",
      erro instanceof Error ? erro.message : "erro desconhecido",
    );
  }

  return resultado;
}
