"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@aether/db";
import {
  criarSalaDeGrupoSchema,
  definirSalasDeGrupoSchema,
  has,
  type ActionResult,
} from "@aether/shared";
import { writeAudit } from "../audit";
import { requireMember, requirePermission } from "../guards";
import { rateLimit } from "../auth/rate-limit";
import { resyncGatewayRooms } from "../realtime-notify";
import {
  criarSalaDeGrupo,
  definirSalasDeGrupo,
} from "../services/salas-de-grupo";
import { fail, ok, toActionError } from "./action-result";

/**
 * Salas de grupo (LFG) — fase 2, estagio 3.
 *
 * Criar uma sala: qualquer membro que pode entrar em voz, com o recurso ligado
 * no servidor. Ligar/desligar o recurso: so MANAGE_SERVER.
 */

export async function criarSalaDeGrupoAction(
  input: unknown,
): Promise<ActionResult<{ channelId: string }>> {
  try {
    const parsed = criarSalaDeGrupoSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(issue?.message ?? "Dados invalidos");
    }

    const context = await requireMember(parsed.data.serverId);

    const server = await prisma.server.findUnique({
      where: { id: parsed.data.serverId },
      select: { salasDeGrupo: true },
    });
    if (!server?.salasDeGrupo) {
      // Nao revelamos detalhe: o toggle esta desligado, ponto.
      return fail("As salas de grupo estao desativadas neste servidor.");
    }

    // O frontend nunca decide: mesmo que o botao apareca, o servidor confere.
    if (!has(context.permissions, "CONNECT")) {
      return fail("Seu cargo nao permite entrar em canais de voz.");
    }

    const limite = await rateLimit(
      `sala-grupo:${context.session.user.id}`,
      5,
      10 * 60_000,
    );
    if (!limite.ok) {
      return fail(`Muitas salas seguidas. Tente de novo em ${limite.retryAfter}s.`);
    }

    const { channelId, jaExistia } = await criarSalaDeGrupo({
      serverId: parsed.data.serverId,
      jogo: parsed.data.jogo,
      criadaPor: context.session.user.id,
    });

    if (!jaExistia) {
      // O gateway precisa saber do canal novo para colocar todo mundo na sala.
      await resyncGatewayRooms({ serverId: parsed.data.serverId });
      revalidatePath(`/app/s/${parsed.data.serverId}`, "layout");
    }

    return ok({ channelId });
  } catch (error) {
    return toActionError(error);
  }
}

export async function definirSalasDeGrupoAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const parsed = definirSalasDeGrupoSchema.safeParse(input);
    if (!parsed.success) return fail("Dados invalidos");

    const context = await requirePermission(
      parsed.data.serverId,
      "MANAGE_SERVER",
    );

    await definirSalasDeGrupo(parsed.data.serverId, parsed.data.ligado);

    await writeAudit({
      serverId: parsed.data.serverId,
      actorId: context.session.user.id,
      action: "server.update",
      targetType: "server",
      targetId: parsed.data.serverId,
      metadata: { salasDeGrupo: parsed.data.ligado },
    });

    revalidatePath(`/app/s/${parsed.data.serverId}`, "layout");
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}
