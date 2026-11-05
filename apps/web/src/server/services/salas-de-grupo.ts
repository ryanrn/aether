import "server-only";

import { prisma } from "@aether/db";

/**
 * Salas de grupo (LFG) — fase 2, estagio 3.
 *
 * Uma sala de grupo e um canal de voz `isTemporary` com `jogo` preenchido. Ela
 * nasce aqui (web) e morre no gateway (`talvezRemoverSalaEfemera` /
 * `varrerSalasEfemeras`) quando esvazia. Nao ha "excluir sala" — ela some
 * sozinha.
 */

/** Teto de salas de grupo abertas ao mesmo tempo num servidor. */
export const MAX_SALAS_DE_GRUPO_POR_SERVIDOR = 8;

export async function criarSalaDeGrupo(params: {
  serverId: string;
  jogo: string;
  criadaPor: string;
  /**
   * Teto de salas abertas neste servidor. O padrao e o de servidor comum; o
   * hub (4b) passa o dele. Parametro, e nao uma segunda funcao: os limites
   * (1 por pessoa, teto) sao a mesma regra, e duas copias divergiriam.
   */
  teto?: number;
  /** Lotacao da sala (`Channel.userLimit`). Ausente = sem limite. */
  tamanho?: number;
}): Promise<{ channelId: string; jaExistia: boolean }> {
  const jogo = params.jogo.trim().slice(0, 64);

  /**
   * Uma sala ativa por pessoa por servidor. Se ja tem, devolve a que existe em
   * vez de criar outra — o botao "Criar sala" clicado duas vezes leva pro
   * mesmo lugar.
   */
  const minhaSala = await prisma.channel.findFirst({
    where: {
      serverId: params.serverId,
      isTemporary: true,
      criadaPor: params.criadaPor,
    },
    select: { id: true },
  });
  if (minhaSala) return { channelId: minhaSala.id, jaExistia: true };

  const abertas = await prisma.channel.count({
    where: { serverId: params.serverId, isTemporary: true },
  });
  if (abertas >= (params.teto ?? MAX_SALAS_DE_GRUPO_POR_SERVIDOR)) {
    throw new Error(
      "Este servidor esta com salas de grupo demais abertas agora. Tente daqui a pouco.",
    );
  }

  // Posicao alta: a sala entra no fim dos canais soltos, nao no meio da arvore.
  const ultimo = await prisma.channel.findFirst({
    where: { serverId: params.serverId, categoryId: null },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const channel = await prisma.channel.create({
    data: {
      serverId: params.serverId,
      name: jogo,
      type: "VOICE",
      categoryId: null,
      isTemporary: true,
      jogo,
      criadaPor: params.criadaPor,
      // "Canal cheio" ja e regra do `entrarNaVoz` — a lotacao do hub nao
      // precisa de codigo novo no gateway.
      userLimit: params.tamanho ?? null,
      position: (ultimo?.position ?? -1) + 1,
    },
    select: { id: true },
  });

  return { channelId: channel.id, jaExistia: false };
}

/**
 * Liga/desliga as salas de grupo no servidor. Desligar NAO apaga as salas
 * abertas — elas somem quando esvaziam, como qualquer sala temporaria; so
 * impede novas.
 */
export async function definirSalasDeGrupo(
  serverId: string,
  ligado: boolean,
): Promise<void> {
  await prisma.server.update({
    where: { id: serverId },
    data: { salasDeGrupo: ligado },
  });
}
