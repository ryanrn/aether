"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@aether/db";
import {
  createServerSchema,
  joinServerSchema,
  updateServerSchema,
  type ActionResult,
} from "@aether/shared";
import { clientKey, rateLimit } from "../auth/rate-limit";
import { writeAudit } from "../audit";
import { requireMember, requirePermission, requireUser } from "../guards";
import {
  createServerForUser,
  generateInviteCode,
} from "../services/servers";
import { joinServerByCode } from "../services/invites";
import { fail, ok, toActionError } from "./action-result";

export async function createServerAction(
  _prev: ActionResult<{ serverId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ serverId: string }>> {
  let serverId: string;
  try {
    const session = await requireUser();

    const limit = rateLimit(`create-server:${session.user.id}`, 5, 60 * 60_000);
    if (!limit.ok) {
      return fail("Limite de criacao de servidores atingido. Tente mais tarde.");
    }

    const parsed = createServerSchema.safeParse({ name: formData.get("name") });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Nome invalido", "name");
    }

    const result = await createServerForUser({
      ownerId: session.user.id,
      name: parsed.data.name,
    });
    serverId = result.serverId;

    await writeAudit({
      serverId,
      actorId: session.user.id,
      action: "server.create",
      targetType: "server",
      targetId: serverId,
      metadata: { name: parsed.data.name },
    });
  } catch (error) {
    return toActionError(error);
  }

  revalidatePath("/app");
  redirect(`/app/s/${serverId}`);
}

export async function joinServerAction(
  _prev: ActionResult<{ serverId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ serverId: string }>> {
  let serverId: string;
  try {
    const session = await requireUser();

    const limit = rateLimit(await clientKey("join-server"), 20, 10 * 60_000);
    if (!limit.ok) {
      return fail(`Muitas tentativas. Aguarde ${limit.retryAfter}s.`);
    }

    const parsed = joinServerSchema.safeParse({ code: formData.get("code") });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Codigo invalido", "code");
    }

    const result = await joinServerByCode(session.user.id, parsed.data.code);
    if (!result.ok) return result;
    serverId = result.data.serverId;
  } catch (error) {
    return toActionError(error);
  }

  revalidatePath("/app");
  redirect(`/app/s/${serverId}`);
}

/** Gera um convite novo. Exige a permissao CREATE_INVITE. */
export async function createInviteAction(
  serverId: string,
): Promise<ActionResult<{ code: string }>> {
  try {
    const context = await requirePermission(serverId, "CREATE_INVITE");

    const limit = rateLimit(`invite:${context.session.user.id}`, 15, 60 * 60_000);
    if (!limit.ok) {
      return fail(`Muitos convites gerados. Aguarde ${limit.retryAfter}s.`);
    }

    const code = generateInviteCode();
    await prisma.invite.create({
      data: { code, serverId, creatorId: context.session.user.id },
    });

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "invite.create",
      targetType: "invite",
      targetId: code,
    });

    return ok({ code });
  } catch (error) {
    return toActionError(error);
  }
}

/** Convite mais recente ainda valido, para o botao "convidar". */
export async function getOrCreateInviteAction(
  serverId: string,
): Promise<ActionResult<{ code: string }>> {
  try {
    await requirePermission(serverId, "CREATE_INVITE");

    const existing = await prisma.invite.findFirst({
      where: {
        serverId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: "desc" },
      select: { code: true, maxUses: true, uses: true },
    });

    if (existing && (existing.maxUses === null || existing.uses < existing.maxUses)) {
      return ok({ code: existing.code });
    }
    return createInviteAction(serverId);
  } catch (error) {
    return toActionError(error);
  }
}

/** Renomeia o servidor. Exige MANAGE_SERVER. */
export async function updateServerAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const parsed = updateServerSchema.safeParse(input);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Nome invalido", "name");
    }

    const context = await requirePermission(parsed.data.serverId, "MANAGE_SERVER");

    await prisma.server.update({
      where: { id: parsed.data.serverId },
      data: { name: parsed.data.name },
    });

    await writeAudit({
      serverId: parsed.data.serverId,
      actorId: context.session.user.id,
      action: "server.update",
      targetType: "server",
      targetId: parsed.data.serverId,
      metadata: { name: parsed.data.name },
    });

    revalidatePath(`/app/s/${parsed.data.serverId}`, "layout");
    revalidatePath("/app");
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

/** Sair do servidor. O dono nao pode sair sem transferir a posse (fase 6). */
export async function leaveServerAction(
  serverId: string,
): Promise<ActionResult<undefined>> {
  try {
    const context = await requireMember(serverId);
    if (context.isOwner) {
      return fail("O dono nao pode sair do proprio servidor.");
    }

    await prisma.serverMember.delete({ where: { id: context.memberId } });
    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "server.leave",
      targetType: "user",
      targetId: context.session.user.id,
    });

    revalidatePath("/app");
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}
