import "server-only";

import { prisma } from "@aether/db";
import type { ActionResult } from "@aether/shared";
import { writeAudit } from "../audit";

/**
 * Regras de convite.
 *
 * IMPORTANTE: este arquivo NAO e "use server". Funcoes que recebem userId como
 * parametro nunca podem ser server actions — um cliente malicioso poderia
 * chamar a action passando o id de outra pessoa. Quem chama aqui ja resolveu
 * a sessao pelo cookie.
 */
export async function joinServerByCode(
  userId: string,
  code: string,
): Promise<ActionResult<{ serverId: string }>> {
  const invite = await prisma.invite.findUnique({
    where: { code: code.toLowerCase() },
    select: {
      id: true,
      serverId: true,
      uses: true,
      maxUses: true,
      expiresAt: true,
    },
  });

  if (!invite) return { ok: false, error: "Convite invalido ou expirado", field: "code" };
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "Convite invalido ou expirado", field: "code" };
  }
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
    return { ok: false, error: "Este convite atingiu o limite de usos", field: "code" };
  }

  const banned = await prisma.ban.findUnique({
    where: { serverId_userId: { serverId: invite.serverId, userId } },
    select: { id: true },
  });
  if (banned) {
    return { ok: false, error: "Voce esta banido deste servidor", field: "code" };
  }

  const existing = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId: invite.serverId, userId } },
    select: { id: true },
  });
  if (existing) return { ok: true, data: { serverId: invite.serverId } };

  const defaultRole = await prisma.role.findFirst({
    where: { serverId: invite.serverId, isDefault: true },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    const member = await tx.serverMember.create({
      data: { serverId: invite.serverId, userId },
    });
    if (defaultRole) {
      await tx.memberRole.create({
        data: { memberId: member.id, roleId: defaultRole.id },
      });
    }
    await tx.invite.update({
      where: { id: invite.id },
      data: { uses: { increment: 1 } },
    });
  });

  await writeAudit({
    serverId: invite.serverId,
    actorId: userId,
    action: "invite.use",
    targetType: "user",
    targetId: userId,
  });

  return { ok: true, data: { serverId: invite.serverId } };
}
