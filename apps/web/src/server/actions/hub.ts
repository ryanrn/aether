"use server";

import { revalidatePath } from "next/cache";
import {
  banExpiryFrom,
  banDurationSchema,
  criarSalaNoHubSchema,
  entrarNoHubSchema,
  type ActionResult,
} from "@aether/shared";
import { log } from "@aether/shared/log";
import { requireUser, sessaoDaEquipe } from "../guards";
import { writeAudit } from "../audit";
import { rateLimit } from "../auth/rate-limit";
import { evictFromGateway, resyncGatewayRooms } from "../realtime-notify";
import { banirDoHub, criarSalaNoHub, entrarNoHub } from "../services/hub";
import { fail, ok, toActionError } from "./action-result";

/**
 * Hub global "AETHER · Grupos" (fase 2, estagio 4b-1).
 *
 * A action so faz o que e de entrada: sessao, formato, rate limit. Quem decide
 * se a pessoa pode entrar (flag, conta, ban) e `services/hub.ts`, que relê tudo
 * no servidor — a tela so esconde o botao.
 */

export async function entrarNoHubAction(
  input: unknown,
): Promise<ActionResult<{ hubId: string }>> {
  try {
    const parsed = entrarNoHubSchema.safeParse(input);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Dados invalidos");
    }
    const session = await requireUser();

    const limite = await rateLimit(`hub-entrar:${session.user.id}`, 10, 10 * 60_000);
    if (!limite.ok) return fail(`Muitas tentativas. Tente em ${limite.retryAfter}s.`);

    const r = await entrarNoHub(session.user.id);
    if (r.ok) {
      // O gateway coloca o socket nas salas do hub no proximo `server:join`;
      // o trilho mostra o servidor novo no proximo render.
      revalidatePath("/app", "layout");
    }
    return r;
  } catch (error) {
    return toActionError(error);
  }
}

export async function criarSalaNoHubAction(
  input: unknown,
): Promise<ActionResult<{ hubId: string; channelId: string }>> {
  try {
    const parsed = criarSalaNoHubSchema.safeParse(input);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Dados invalidos");
    }
    const session = await requireUser();

    // Mesmo limite das salas de grupo de servidor.
    const limite = await rateLimit(`sala-grupo:${session.user.id}`, 5, 10 * 60_000);
    if (!limite.ok) {
      return fail(`Muitas salas seguidas. Tente de novo em ${limite.retryAfter}s.`);
    }

    const r = await criarSalaNoHub({
      userId: session.user.id,
      jogo: parsed.data.jogo,
      tamanho: parsed.data.tamanho,
    });
    if (!r.ok) return r;

    if (!r.data.jaExistia) {
      await resyncGatewayRooms({ serverId: r.data.hubId });
      revalidatePath(`/app/s/${r.data.hubId}`, "layout");
    }
    return ok({ hubId: r.data.hubId, channelId: r.data.channelId });
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Bane do hub (estagio 4b-2) — so EQUIPE. Chamado da fila de denuncias.
 *
 * Quem nao e equipe recebe "Nao encontrado", como em toda acao da equipe: a
 * resposta nao confirma que a acao existe.
 */
export async function banirDoHubAction(input: {
  userId: string;
  duracao: string;
  motivo?: string;
}): Promise<ActionResult<undefined>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");

    const userId = String(input?.userId ?? "");
    if (!userId) return fail("Usuario invalido");
    if (userId === sessao.user.id) return fail("Voce nao pode banir a si mesmo.");
    const duracao = banDurationSchema.safeParse(input?.duracao);
    if (!duracao.success) return fail("Duracao invalida");

    const ate = banExpiryFrom(duracao.data);
    const motivo = input?.motivo?.toString().slice(0, 500).trim() || null;
    const r = await banirDoHub({ userId, porQuem: sessao.user.id, motivo, ate });
    if (!r.ok) return r;

    // Tira das salas do hub e da call na hora — mesmo caminho do ban comum.
    await evictFromGateway({ serverId: r.data.hubId, userId });

    log.warn("moderacao.banido_do_hub", "usuario banido do hub", {
      alvo: userId,
      por: sessao.user.id,
      ate: ate?.toISOString() ?? "permanente",
    });
    await writeAudit({
      serverId: r.data.hubId,
      actorId: sessao.user.id,
      action: "member.ban",
      targetType: "user",
      targetId: userId,
      metadata: { via: "hub", duracao: duracao.data, motivo },
    });
    revalidatePath("/app/equipe");
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}
