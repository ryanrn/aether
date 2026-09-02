"use server";

import { revalidatePath } from "next/cache";
import {
  definirVisibilidade,
  desconectarSpotify,
} from "@aether/access";
import { type ActionResult } from "@aether/shared";
import { requireUser } from "../guards";
import { fail, ok, toActionError } from "./action-result";

/**
 * Conta do Spotify — desligar e as duas chaves de visibilidade.
 *
 * Sem `userId` na entrada: cada pessoa so mexe na propria, e o id vem do
 * cookie. O CONECTAR nao e action (termina em redirect para outro dominio) —
 * mora em `/api/spotify/connect`.
 *
 * `revalidatePath("/app")` porque a atividade da pessoa aparece em varios
 * pontos abaixo desse layout; a mudanca de "mostrar o Spotify" precisa
 * refletir na proxima renderizacao. O que trafega em tempo real (a musica em
 * si) e o poller do gateway que resolve.
 */

export async function disconnectSpotifyAction(): Promise<ActionResult> {
  try {
    const session = await requireUser();
    await desconectarSpotify(session.user.id);
    revalidatePath("/app");
    return ok(undefined);
  } catch (error) {
    return toActionError(error);
  }
}

export async function setSpotifyVisibilityAction(patch: {
  showOnProfile?: boolean;
  showAsStatus?: boolean;
}): Promise<ActionResult> {
  try {
    const session = await requireUser();
    const limpo: { showOnProfile?: boolean; showAsStatus?: boolean } = {};
    if (typeof patch.showOnProfile === "boolean")
      limpo.showOnProfile = patch.showOnProfile;
    if (typeof patch.showAsStatus === "boolean")
      limpo.showAsStatus = patch.showAsStatus;
    if (Object.keys(limpo).length === 0) return fail("Nada para mudar");

    await definirVisibilidade(session.user.id, limpo);
    revalidatePath("/app");
    return ok(undefined);
  } catch (error) {
    return toActionError(error);
  }
}
