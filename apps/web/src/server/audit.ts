import "server-only";

import { prisma } from "@aether/db";
import { log } from "@aether/shared/log";

/**
 * Registro de auditoria. Alimentado desde a fase 1 para que o painel
 * administrativo da fase 6 tenha historico real desde o inicio.
 *
 * NAO HA "server.delete" NESTA LISTA, DE PROPOSITO. `AuditLog.serverId` tem
 * `onDelete: Cascade` a partir de `Server` — gravar aqui e apagar o servidor
 * na sequencia apagaria o proprio registro junto. Nao ha como este log
 * sobreviver ao que ele descreveria; documentado como limitacao no README em
 * vez de fingir um rastro que a exclusao sempre levaria embora.
 *
 * AS ACOES "global.*" NAO PERTENCEM A NENHUM SERVIDOR (`serverId: null`) —
 * kill switch, chave de plano, cosmetico, bloqueio de aplicacao. Antes da
 * migracao `20260913120000_auditoria_global`, `serverId` era obrigatorio e
 * essas acoes nao tinham como entrar aqui; o rastro delas ficava so no log
 * estruturado (`log.*`), nunca pesquisavel dentro do proprio produto.
 */
export type AuditAction =
  | "server.create"
  | "server.update"
  | "server.join"
  | "server.leave"
  | "server.transfer_ownership"
  | "invite.create"
  | "invite.use"
  | "invite.revoke"
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
  | "member.mute"
  | "member.nickname"
  | "bot.install"
  | "bot.uninstall"
  | "webhook.create"
  | "webhook.revoke"
  | "global.flag_alterada"
  | "global.chave_criada"
  | "global.chave_revogada"
  | "global.cosmetico_criado"
  | "global.cosmetico_editado"
  | "global.cosmetico_excluido"
  | "global.cosmetico_publicado"
  | "global.moedas_concedidas"
  | "global.aplicacao_bloqueada"
  | "global.aplicacao_desbloqueada"
  | "global.usuario_silenciado"
  | "global.silenciamento_removido"
  | "global.mensagem_apagada_moderacao";

export async function writeAudit(params: {
  /** `null` so para as acoes "global.*" — todo o resto exige servidor. */
  serverId: string | null;
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
    log.error("audit.falhou", "falha ao gravar linha de auditoria", {
      err: error,
      acao: params.action,
      serverId: params.serverId,
    });
  }
}

/** As acoes GLOBAIS mais recentes — pra tela de auditoria do painel. */
export interface EntradaDeAuditoriaGlobal {
  id: string;
  actorUsername: string | null;
  action: AuditAction;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export async function listarAuditoriaGlobal(
  limite = 100,
): Promise<EntradaDeAuditoriaGlobal[]> {
  const linhas = await prisma.auditLog.findMany({
    where: { serverId: null },
    orderBy: { createdAt: "desc" },
    take: Math.min(limite, 200),
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      metadata: true,
      createdAt: true,
      actor: { select: { username: true } },
    },
  });
  return linhas.map((l) => ({
    id: l.id,
    actorUsername: l.actor?.username ?? null,
    action: l.action as AuditAction,
    targetType: l.targetType,
    targetId: l.targetId,
    metadata: (l.metadata as Record<string, unknown> | null) ?? null,
    createdAt: l.createdAt.toISOString(),
  }));
}
