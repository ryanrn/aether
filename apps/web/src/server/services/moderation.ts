import "server-only";

import { prisma } from "@aether/db";
import type { PublicUser, UserStatus } from "@aether/shared";

/**
 * Camada de dados da moderacao.
 *
 * Sem checagem de permissao aqui: quem chama ja passou pelos guards e pela
 * hierarquia. Mesma convencao dos outros services.
 */

export interface ServerBan {
  userId: string;
  user: PublicUser;
  reason: string | null;
  /** null = permanente */
  expiresAt: string | null;
  createdAt: string;
  issuedBy: { id: string; displayName: string } | null;
}

const BAN_SELECT = {
  userId: true,
  reason: true,
  expiresAt: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      status: true,
    },
  },
  issuedBy: { select: { id: true, displayName: true } },
} as const;

/**
 * Banimentos que ainda valem.
 *
 * Vencidos sao filtrados na consulta em vez de apagados por rotina: nao ha
 * processo de limpeza rodando, e um banimento vencido que continua na tabela
 * ainda serve como historico de que aconteceu.
 */
export async function listActiveBans(serverId: string): Promise<ServerBan[]> {
  const rows = await prisma.ban.findMany({
    where: {
      serverId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: BAN_SELECT,
    orderBy: { createdAt: "desc" },
  });

  return rows.map((row) => ({
    userId: row.userId,
    reason: row.reason,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    issuedBy: row.issuedBy,
    user: {
      id: row.user.id,
      username: row.user.username,
      displayName: row.user.displayName,
      avatarUrl: row.user.avatarUrl,
      status: row.user.status as UserStatus,
    },
  }));
}

/** Remove a participacao. A pessoa pode voltar por convite. */
export async function removeMember(memberId: string): Promise<void> {
  // O cascade do schema derruba MemberRole junto.
  await prisma.serverMember.delete({ where: { id: memberId } });
}

/**
 * Bane e remove a participacao numa transacao.
 *
 * As duas coisas precisam acontecer juntas: banir sem remover deixaria a
 * pessoa dentro do servidor com um banimento decorativo, e remover sem banir
 * deixaria ela voltar pelo primeiro convite.
 */
export async function banMember(params: {
  serverId: string;
  memberId: string;
  userId: string;
  issuedById: string;
  reason: string | null;
  expiresAt: Date | null;
}): Promise<void> {
  await prisma.$transaction([
    prisma.ban.upsert({
      where: {
        serverId_userId: { serverId: params.serverId, userId: params.userId },
      },
      create: {
        serverId: params.serverId,
        userId: params.userId,
        issuedById: params.issuedById,
        reason: params.reason,
        expiresAt: params.expiresAt,
      },
      // Rebanir alguem ja banido renova motivo e prazo em vez de falhar.
      update: {
        issuedById: params.issuedById,
        reason: params.reason,
        expiresAt: params.expiresAt,
        createdAt: new Date(),
      },
    }),
    prisma.serverMember.deleteMany({ where: { id: params.memberId } }),
  ]);
}

export async function unban(serverId: string, userId: string): Promise<boolean> {
  const result = await prisma.ban.deleteMany({ where: { serverId, userId } });
  return result.count > 0;
}
