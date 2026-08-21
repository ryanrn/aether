import "server-only";

import { prisma } from "@aether/db";

/**
 * Leitura do log de auditoria.
 *
 * O log guarda IDs, nao nomes — de proposito: nome muda, ID nao, e gravar o
 * nome do jeito que estava congelaria um dado que pode ser corrigido depois.
 * O custo e resolver os nomes na leitura, o que fazemos em LOTE: uma consulta
 * por tipo de alvo, nunca uma por linha.
 *
 * Quando o alvo nao existe mais (canal excluido, cargo removido), caimos no
 * nome que ficou no metadata e, se nem isso houver, dizemos que sumiu — em vez
 * de mostrar um ID cru para quem esta lendo.
 */

export const AUDIT_PAGE_SIZE = 30;

export interface AuditEntry {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; displayName: string } | null;
  targetType: string | null;
  /** nome resolvido do alvo, quando foi possivel */
  targetLabel: string | null;
  /** nomes de cargos citados no metadata, ja resolvidos */
  roleLabels: string[];
  reason: string | null;
  metadata: Record<string, unknown> | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** IDs de cargo citados no metadata, sob as chaves que as actions usam. */
function roleIdsFrom(metadata: Record<string, unknown> | null): string[] {
  if (!metadata) return [];
  const keys = ["assigned", "unassigned", "roleId"];
  return keys
    .map((key) => metadata[key])
    .filter((value): value is string => typeof value === "string");
}

export async function listAuditLog(
  serverId: string,
  options: { before?: string } = {},
): Promise<{ entries: AuditEntry[]; hasMore: boolean }> {
  const rows = await prisma.auditLog.findMany({
    where: { serverId },
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      metadata: true,
      createdAt: true,
      actor: { select: { id: true, displayName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: AUDIT_PAGE_SIZE + 1,
    ...(options.before
      ? { cursor: { id: options.before }, skip: 1 }
      : {}),
  });

  const hasMore = rows.length > AUDIT_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, AUDIT_PAGE_SIZE) : rows;

  // Agrupa os alvos por tipo para resolver tudo em poucas consultas.
  const userIds = new Set<string>();
  const memberIds = new Set<string>();
  const channelIds = new Set<string>();
  const roleIds = new Set<string>();

  for (const row of page) {
    const metadata = asRecord(row.metadata);
    for (const id of roleIdsFrom(metadata)) roleIds.add(id);

    if (!row.targetId) continue;
    if (row.targetType === "user") userIds.add(row.targetId);
    else if (row.targetType === "member") memberIds.add(row.targetId);
    else if (row.targetType === "channel") channelIds.add(row.targetId);
    else if (row.targetType === "role") roleIds.add(row.targetId);
  }

  const [users, members, channels, roles] = await Promise.all([
    userIds.size
      ? prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, displayName: true },
        })
      : [],
    memberIds.size
      ? prisma.serverMember.findMany({
          where: { id: { in: [...memberIds] } },
          select: { id: true, user: { select: { displayName: true } } },
        })
      : [],
    channelIds.size
      ? prisma.channel.findMany({
          where: { id: { in: [...channelIds] } },
          select: { id: true, name: true },
        })
      : [],
    roleIds.size
      ? prisma.role.findMany({
          where: { id: { in: [...roleIds] } },
          select: { id: true, name: true },
        })
      : [],
  ]);

  const userNames = new Map(users.map((u) => [u.id, u.displayName]));
  const memberNames = new Map(members.map((m) => [m.id, m.user.displayName]));
  const channelNames = new Map(channels.map((c) => [c.id, c.name]));
  const roleNames = new Map(roles.map((r) => [r.id, r.name]));

  const entries: AuditEntry[] = page.map((row) => {
    const metadata = asRecord(row.metadata);
    const fallbackName =
      typeof metadata?.name === "string" ? metadata.name : null;

    let targetLabel: string | null = null;
    if (row.targetId) {
      if (row.targetType === "user") {
        targetLabel = userNames.get(row.targetId) ?? null;
      } else if (row.targetType === "member") {
        targetLabel = memberNames.get(row.targetId) ?? null;
      } else if (row.targetType === "channel") {
        targetLabel = channelNames.get(row.targetId) ?? null;
      } else if (row.targetType === "role") {
        targetLabel = roleNames.get(row.targetId) ?? null;
      }
      // Alvo apagado: o nome que ficou no metadata ainda serve de referencia.
      targetLabel ??= fallbackName;
    } else {
      targetLabel = fallbackName;
    }

    return {
      id: row.id,
      action: row.action,
      createdAt: row.createdAt.toISOString(),
      actor: row.actor,
      targetType: row.targetType,
      targetLabel,
      roleLabels: roleIdsFrom(metadata)
        .map((id) => roleNames.get(id))
        .filter((name): name is string => Boolean(name)),
      reason: typeof metadata?.reason === "string" ? metadata.reason : null,
      metadata,
    };
  });

  return { entries, hasMore };
}
