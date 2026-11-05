"use server";

import { revalidatePath } from "next/cache";
import {
  criarSalaNoHubSchema,
  entrarNoHubSchema,
  type ActionResult,
} from "@aether/shared";
import { requireUser } from "../guards";
import { rateLimit } from "../auth/rate-limit";
import { resyncGatewayRooms } from "../realtime-notify";
import { criarSalaNoHub, entrarNoHub } from "../services/hub";
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
