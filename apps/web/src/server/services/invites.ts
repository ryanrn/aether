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
/**
 * Sinal interno para abortar a transacao quando o convite esgota entre a
 * leitura e a gravacao. Nao vaza para fora: vira `ActionResult` no catch.
 */
class InviteEsgotado extends Error {}

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

  /**
   * O CONSUMO VEM PRIMEIRO, e condicionado.
   *
   * A checagem la em cima (`invite.uses >= invite.maxUses`) le fora da
   * transacao, e entre ler e gravar cabe outra requisicao. Duas pessoas
   * resgatando um convite de uso unico ao mesmo tempo liam `uses = 0` as
   * duas, passavam as duas, e entravam as duas — o convite acabava com
   * `uses = 2` e um limite de 1. Nao e teorico: `join-server` aceita 20
   * tentativas por IP a cada 10 minutos, e disparar 20 em paralelo e trivial.
   *
   * `updateMany` com `uses < maxUses` no WHERE resolve porque a condicao passa
   * a ser avaliada pelo Postgres com a linha ja travada. Quem chegar depois
   * espera o commit e reavalia contra o valor novo — e leva `count = 0`.
   *
   * A ordem importa: gravar o consumo ANTES de criar o membro faz a linha do
   * convite ser o ponto de serializacao da transacao inteira. Ao contrario, as
   * duas transacoes correriam ate o fim antes de disputar.
   */
  try {
    await prisma.$transaction(async (tx) => {
      if (invite.maxUses !== null) {
        const { count } = await tx.invite.updateMany({
          where: { id: invite.id, uses: { lt: invite.maxUses } },
          data: { uses: { increment: 1 } },
        });
        if (count === 0) throw new InviteEsgotado();
      } else {
        await tx.invite.update({
          where: { id: invite.id },
          data: { uses: { increment: 1 } },
        });
      }

      const member = await tx.serverMember.create({
        data: { serverId: invite.serverId, userId },
      });
      if (defaultRole) {
        await tx.memberRole.create({
          data: { memberId: member.id, roleId: defaultRole.id },
        });
      }
    });
  } catch (error) {
    if (error instanceof InviteEsgotado) {
      return {
        ok: false,
        error: "Este convite atingiu o limite de usos",
        field: "code",
      };
    }
    throw error;
  }

  await writeAudit({
    serverId: invite.serverId,
    actorId: userId,
    action: "invite.use",
    targetType: "user",
    targetId: userId,
  });

  return { ok: true, data: { serverId: invite.serverId } };
}
