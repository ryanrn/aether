import "server-only";

import { prisma } from "@aether/db";
import { normalizarNome } from "@aether/shared";
import { ocupacaoDeCanais } from "../realtime-notify";

/**
 * Grupos (LFG) pelos seus servidores — fase 2, estagio 4a.
 *
 * A tela de Grupos cruza servidores: mostra as salas de grupo (canais
 * `isTemporary` com `jogo`, do estagio 3) abertas em TODOS os servidores onde
 * voce e membro, nao so no que voce esta olhando.
 *
 * A lista vem do banco; a ocupacao ("quantos estao na sala agora") vem do
 * gateway, que e a unica fonte disso. Se o gateway nao responde, a sala aparece
 * sem o contador em vez de dizer "vazia".
 */

export interface SalaDeGrupo {
  channelId: string;
  serverId: string;
  serverNome: string;
  serverIcone: string | null;
  jogo: string;
  criadaPorNome: string | null;
  /** `null` quando o gateway nao respondeu */
  ocupacao: number | null;
  criadaEm: string;
}

export interface GrupoPorJogo {
  jogo: string;
  salas: SalaDeGrupo[];
}

export async function listarGruposDosMeusServidores(
  userId: string,
): Promise<GrupoPorJogo[]> {
  const memberships = await prisma.serverMember.findMany({
    where: { userId },
    select: { serverId: true },
  });
  const serverIds = memberships.map((m) => m.serverId);
  if (serverIds.length === 0) return [];

  const canais = await prisma.channel.findMany({
    where: {
      serverId: { in: serverIds },
      isTemporary: true,
      isPrivate: false,
      jogo: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      serverId: true,
      jogo: true,
      criadaPor: true,
      createdAt: true,
      server: { select: { name: true, iconUrl: true } },
    },
  });
  if (canais.length === 0) return [];

  const criadorIds = [
    ...new Set(
      canais.map((c) => c.criadaPor).filter((v): v is string => v !== null),
    ),
  ];
  const criadores = criadorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: criadorIds } },
        select: { id: true, displayName: true, username: true },
      })
    : [];
  const nomePorId = new Map(
    criadores.map((u) => [u.id, u.displayName || u.username]),
  );

  const ocupacao = await ocupacaoDeCanais(canais.map((c) => c.id));

  // Agrupa pela forma canonica do jogo; mostra o nome como foi digitado.
  const grupos = new Map<string, GrupoPorJogo>();
  for (const canal of canais) {
    if (!canal.jogo) continue;
    const chave = normalizarNome(canal.jogo);
    const grupo = grupos.get(chave) ?? { jogo: canal.jogo, salas: [] };
    grupo.salas.push({
      channelId: canal.id,
      serverId: canal.serverId,
      serverNome: canal.server.name,
      serverIcone: canal.server.iconUrl,
      jogo: canal.jogo,
      criadaPorNome: canal.criadaPor
        ? (nomePorId.get(canal.criadaPor) ?? null)
        : null,
      ocupacao: ocupacao ? (ocupacao[canal.id] ?? 0) : null,
      criadaEm: canal.createdAt.toISOString(),
    });
    grupos.set(chave, grupo);
  }

  return [...grupos.values()]
    .map((grupo) => ({
      ...grupo,
      salas: grupo.salas.sort((a, b) => (b.ocupacao ?? 0) - (a.ocupacao ?? 0)),
    }))
    .sort((a, b) => b.salas.length - a.salas.length);
}

/** Seus servidores que permitem salas de grupo — para o seletor do "Criar". */
export async function servidoresParaGrupo(
  userId: string,
): Promise<{ id: string; nome: string }[]> {
  const membros = await prisma.serverMember.findMany({
    where: { userId, server: { salasDeGrupo: true } },
    orderBy: { joinedAt: "asc" },
    select: { server: { select: { id: true, name: true } } },
  });
  return membros.map((m) => ({ id: m.server.id, nome: m.server.name }));
}
