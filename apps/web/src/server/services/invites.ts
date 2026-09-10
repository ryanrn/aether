import "server-only";

import { prisma } from "@aether/db";
import type { ActionResult } from "@aether/shared";
import { writeAudit } from "../audit";
import { banAtivo } from "./moderation";

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

/** Por que um convite nao pode ser usado — cada um vira uma mensagem propria. */
export type InviteMotivoInvalido =
  | "inexistente"
  | "revogado"
  | "expirado"
  | "esgotado";

const MENSAGEM: Record<InviteMotivoInvalido, string> = {
  inexistente: "Convite invalido.",
  revogado: "Este convite nao esta mais disponivel.",
  expirado: "Este convite expirou.",
  esgotado: "Este convite atingiu o limite de usos.",
};

/**
 * Motivo pelo qual um convite ja carregado nao serve — ou `null` se serve.
 * Uma checagem so, usada tanto pela previa quanto pelo resgate.
 */
function motivoInvalido(invite: {
  revokedAt: Date | null;
  expiresAt: Date | null;
  uses: number;
  maxUses: number | null;
}): InviteMotivoInvalido | null {
  if (invite.revokedAt) return "revogado";
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    return "expirado";
  }
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return "esgotado";
  return null;
}

export interface InvitePreview {
  code: string;
  server: {
    id: string;
    name: string;
    iconUrl: string | null;
    /** total de membros — o numero do card */
    memberCount: number;
  };
  /** o visitante ja e membro deste servidor */
  jaMembro: boolean;
  /** o visitante esta banido deste servidor (so quando ha sessao) */
  banido: boolean;
}

/**
 * O que a pagina de convite mostra ANTES de aceitar: nome, icone e contagem
 * do servidor.
 *
 * Ter o codigo valido E a autorizacao para ver isso — e o mesmo modelo do
 * Discord, e o codigo tem ~49 bits de entropia. Codigo invalido devolve o
 * motivo generico e NADA do servidor: nao confirmamos a existencia de nada
 * para quem chutou um codigo.
 *
 * `userId` opcional: sem sessao ainda da para ver a previa (Cenario 4), so
 * `jaMembro`/`banido` ficam falsos.
 */
export async function invitePreview(
  code: string,
  userId?: string,
): Promise<
  | { ok: true; data: InvitePreview }
  | { ok: false; motivo: InviteMotivoInvalido; error: string }
> {
  const invite = await prisma.invite.findUnique({
    where: { code: code.toLowerCase() },
    select: {
      code: true,
      serverId: true,
      uses: true,
      maxUses: true,
      expiresAt: true,
      revokedAt: true,
      server: { select: { id: true, name: true, iconUrl: true } },
    },
  });

  if (!invite) {
    return { ok: false, motivo: "inexistente", error: MENSAGEM.inexistente };
  }

  const motivo = motivoInvalido(invite);
  if (motivo) return { ok: false, motivo, error: MENSAGEM[motivo] };

  const [memberCount, membro, banido] = await Promise.all([
    prisma.serverMember.count({ where: { serverId: invite.serverId } }),
    userId
      ? prisma.serverMember.findUnique({
          where: { serverId_userId: { serverId: invite.serverId, userId } },
          select: { id: true },
        })
      : Promise.resolve(null),
    userId ? banAtivo(invite.serverId, userId) : Promise.resolve(false),
  ]);

  return {
    ok: true,
    data: {
      code: invite.code,
      server: {
        id: invite.server.id,
        name: invite.server.name,
        iconUrl: invite.server.iconUrl,
        memberCount,
      },
      jaMembro: membro !== null,
      banido,
    },
  };
}

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
      revokedAt: true,
    },
  });

  if (!invite) {
    return { ok: false, error: MENSAGEM.inexistente, field: "code" };
  }

  const motivo = motivoInvalido(invite);
  if (motivo) return { ok: false, error: MENSAGEM[motivo], field: "code" };

  // `banAtivo` (nao `findUnique`) porque ban vencido nao conta — auditoria M2.
  if (await banAtivo(invite.serverId, userId)) {
    return {
      ok: false,
      error: "Voce esta banido deste servidor",
      field: "code",
    };
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
          where: {
            id: invite.id,
            uses: { lt: invite.maxUses },
            revokedAt: null,
          },
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
      return { ok: false, error: MENSAGEM.esgotado, field: "code" };
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
