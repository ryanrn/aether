/**
 * Permissao no nivel de CANAL — usada tanto pelo app web (montar a arvore,
 * guardar server actions) quanto pelo gateway realtime (decidir quem entra em
 * qual sala de eventos). Uma implementacao so, para as duas nao divergirem.
 */
import { prisma } from "@aether/db";
import {
  ALL_PERMISSIONS,
  applyOverwrites,
  has,
  type PermissionBits,
} from "@aether/shared";
import type { MemberAccess } from "./member";

/**
 * Permissoes efetivas POR CANAL.
 *
 * Ordem de resolucao (a mesma do applyOverwrites em @aether/shared):
 *   permissoes base do membro (uniao dos cargos)
 *     -> deny dos overwrites dos cargos dele naquele canal
 *     -> allow dos overwrites dos cargos dele naquele canal
 *     -> deny do overwrite individual
 *     -> allow do overwrite individual
 *
 * Dono e ADMINISTRATOR curto-circuitam para todas as permissoes.
 *
 * Performance: uma unica query traz TODOS os overwrites do servidor que se
 * aplicam a este membro. Sem isso, montar a arvore de canais seria um N+1
 * (uma query por canal) — que e exatamente o tipo de coisa que degrada quando
 * o servidor cresce.
 */
export async function getChannelPermissionMap(
  context: MemberAccess,
): Promise<Map<string, PermissionBits>> {
  const channels = await prisma.channel.findMany({
    where: { serverId: context.serverId },
    select: { id: true, isPrivate: true },
  });

  const map = new Map<string, PermissionBits>();

  if (context.isOwner || has(context.permissions, "ADMINISTRATOR")) {
    for (const channel of channels) map.set(channel.id, ALL_PERMISSIONS);
    return map;
  }

  const overwrites = await prisma.channelOverwrite.findMany({
    where: {
      channel: { serverId: context.serverId },
      OR: [
        { target: "ROLE", roleId: { in: context.roleIds } },
        { target: "MEMBER", memberId: context.memberId },
      ],
    },
    select: {
      channelId: true,
      target: true,
      allow: true,
      deny: true,
    },
  });

  const byChannel = new Map<
    string,
    {
      roles: { allow: PermissionBits; deny: PermissionBits }[];
      member?: { allow: PermissionBits; deny: PermissionBits };
    }
  >();

  for (const overwrite of overwrites) {
    const entry = byChannel.get(overwrite.channelId) ?? { roles: [] };
    if (overwrite.target === "MEMBER") {
      entry.member = { allow: overwrite.allow, deny: overwrite.deny };
    } else {
      entry.roles.push({ allow: overwrite.allow, deny: overwrite.deny });
    }
    byChannel.set(overwrite.channelId, entry);
  }

  for (const channel of channels) {
    const entry = byChannel.get(channel.id);
    let effective = applyOverwrites(
      context.permissions,
      entry?.roles ?? [],
      entry?.member,
    );

    /**
     * Canal privado sem NENHUM overrride que libere explicitamente o acesso e
     * invisivel. Este e o ponto que faz "privado" significar privado de fato:
     * a decisao acontece aqui, no servidor, antes de o canal virar JSON.
     */
    if (channel.isPrivate && !entry) {
      effective = 0n;
    }

    map.set(channel.id, effective);
  }

  return map;
}

/**
 * Guard de canal. Valida em uma unica ida ao banco que:
 *  - o canal pertence ao servidor informado (impede acesso por URL cruzada);
 *  - o membro tem a permissao pedida NAQUELE canal.
 */
export async function getChannelPermissions(
  context: MemberAccess,
  channelId: string,
): Promise<PermissionBits | null> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, serverId: context.serverId },
    select: {
      id: true,
      isPrivate: true,
      overwrites: {
        where: {
          OR: [
            { target: "ROLE", roleId: { in: context.roleIds } },
            { target: "MEMBER", memberId: context.memberId },
          ],
        },
        select: { target: true, allow: true, deny: true },
      },
    },
  });

  if (!channel) return null;

  if (context.isOwner || has(context.permissions, "ADMINISTRATOR")) {
    return ALL_PERMISSIONS;
  }

  const roleOverwrites = channel.overwrites
    .filter((overwrite) => overwrite.target === "ROLE")
    .map((overwrite) => ({ allow: overwrite.allow, deny: overwrite.deny }));
  const memberOverwrite = channel.overwrites.find(
    (overwrite) => overwrite.target === "MEMBER",
  );

  if (channel.isPrivate && channel.overwrites.length === 0) return 0n;

  return applyOverwrites(
    context.permissions,
    roleOverwrites,
    memberOverwrite
      ? { allow: memberOverwrite.allow, deny: memberOverwrite.deny }
      : undefined,
  );
}

/** Serializa o mapa para o cliente (bigint nao e serializavel). */
export function serializePermissionMap(
  map: Map<string, PermissionBits>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [channelId, bits] of map) {
    result[channelId] = bits.toString();
  }
  return result;
}

