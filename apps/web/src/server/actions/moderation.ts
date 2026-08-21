"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@aether/db";
import {
  banExpiryFrom,
  banMemberSchema,
  kickMemberSchema,
  unbanSchema,
  type ActionResult,
} from "@aether/shared";
import { writeAudit } from "../audit";
import { assertHierarchy, requirePermission } from "../guards";
import { evictFromGateway } from "../realtime-notify";
import { banMember, removeMember, unban } from "../services/moderation";
import { fail, ok, toActionError } from "./action-result";

/**
 * Actions de moderacao.
 *
 * Tres travas alem da permissao:
 *  1. hierarquia — so se age sobre membro de cargo estritamente abaixo, e o
 *     dono e intocavel (assertHierarchy, da fase 2);
 *  2. nao se modera a si mesmo;
 *  3. o gateway e avisado para tirar o socket das salas na hora. Sem esse
 *     passo, quem foi expulso continuaria recebendo o chat ate recarregar —
 *     acesso indevido, nao tela desatualizada.
 */

function refresh(serverId: string) {
  revalidatePath(`/app/s/${serverId}`, "layout");
}

/** Descobre a quem pertence a participacao, ja confinado ao servidor certo. */
async function resolveTarget(serverId: string, memberId: string) {
  return prisma.serverMember.findFirst({
    where: { id: memberId, serverId },
    select: { id: true, userId: true },
  });
}

export async function kickMemberAction(
  serverId: string,
  input: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const parsed = kickMemberSchema.safeParse(input);
    if (!parsed.success) return fail("Dados invalidos");

    const context = await requirePermission(serverId, "KICK_MEMBERS");
    if (parsed.data.memberId === context.memberId) {
      return fail("Para sair do servidor, use a opcao de sair.");
    }
    await assertHierarchy(context, parsed.data.memberId);

    const target = await resolveTarget(serverId, parsed.data.memberId);
    if (!target) return fail("Membro nao encontrado");

    await removeMember(target.id);
    await evictFromGateway({ serverId, userId: target.userId });

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "member.kick",
      targetType: "user",
      targetId: target.userId,
      metadata: parsed.data.reason ? { reason: parsed.data.reason } : undefined,
    });

    refresh(serverId);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

export async function banMemberAction(
  serverId: string,
  input: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const parsed = banMemberSchema.safeParse(input);
    if (!parsed.success) return fail("Dados invalidos");

    const context = await requirePermission(serverId, "BAN_MEMBERS");
    if (parsed.data.memberId === context.memberId) {
      return fail("Voce nao pode banir a si mesmo.");
    }
    await assertHierarchy(context, parsed.data.memberId);

    const target = await resolveTarget(serverId, parsed.data.memberId);
    if (!target) return fail("Membro nao encontrado");

    const expiresAt = banExpiryFrom(parsed.data.duration);

    await banMember({
      serverId,
      memberId: target.id,
      userId: target.userId,
      issuedById: context.session.user.id,
      reason: parsed.data.reason?.trim() || null,
      expiresAt,
    });
    await evictFromGateway({ serverId, userId: target.userId });

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "member.ban",
      targetType: "user",
      targetId: target.userId,
      metadata: {
        duration: parsed.data.duration,
        ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
        ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
      },
    });

    refresh(serverId);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Revogar exige BAN_MEMBERS, a mesma permissao de banir.
 *
 * Nao passa por hierarquia: quem foi banido nao e mais membro, entao nao tem
 * cargo para comparar. Exigir hierarquia aqui tornaria impossivel desfazer o
 * banimento de alguem que era mais graduado.
 */
export async function unbanAction(
  serverId: string,
  input: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const parsed = unbanSchema.safeParse(input);
    if (!parsed.success) return fail("Dados invalidos");

    const context = await requirePermission(serverId, "BAN_MEMBERS");
    const removed = await unban(serverId, parsed.data.userId);
    if (!removed) return fail("Banimento nao encontrado");

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "member.unban",
      targetType: "user",
      targetId: parsed.data.userId,
    });

    refresh(serverId);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}
