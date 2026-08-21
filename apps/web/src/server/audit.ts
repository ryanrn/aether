import "server-only";

import { prisma } from "@aether/db";

/**
 * Registro de auditoria. Alimentado desde a fase 1 para que o painel
 * administrativo da fase 6 tenha historico real desde o inicio.
 */
export type AuditAction =
  | "server.create"
  | "server.update"
  | "server.join"
  | "server.leave"
  | "invite.create"
  | "invite.use"
  | "channel.create"
  | "channel.update"
  | "channel.delete"
  | "role.create"
  | "role.update"
  | "role.delete"
  | "member.kick"
  | "member.ban"
  | "member.unban"
  | "member.move"
  | "member.mute";

export async function writeAudit(params: {
  serverId: string;
  actorId: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        serverId: params.serverId,
        actorId: params.actorId,
        action: params.action,
        targetType: params.targetType ?? null,
        targetId: params.targetId ?? null,
        metadata: (params.metadata ?? undefined) as never,
      },
    });
  } catch (error) {
    // Auditoria nunca pode derrubar a acao principal.
    console.error("[audit] falha ao registrar", params.action, error);
  }
}
