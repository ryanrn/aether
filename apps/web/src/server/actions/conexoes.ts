"use server";

import { revalidatePath } from "next/cache";
import {
  desconectar,
  definirVisibilidadeDaConexao,
  provedor,
  type ConnectionProvider,
} from "@aether/access";
import { type ActionResult } from "@aether/shared";
import { requireUser } from "../guards";
import { fail, ok, toActionError } from "./action-result";

/**
 * Conexoes com servicos externos — desligar e as duas chaves de visibilidade.
 *
 * GENERICA: uma action para todo provedor, no lugar de um par por servico. O
 * CONECTAR nao entra aqui (termina em redirect para outro dominio) — mora nas
 * rotas `/api/conexoes/[provider]/connect` e, para o Spotify, na dele.
 *
 * Sem `userId` na entrada: cada pessoa so mexe na propria, e o id vem do
 * cookie. `provider` E validado — vem do client, e uma string que vira chave
 * de enum e de busca.
 *
 * `revalidatePath("/app")` porque a atividade da pessoa aparece em varios
 * pontos abaixo desse layout. O que trafega em tempo real (a musica em si) e
 * o poller do gateway que resolve.
 */

const VALIDOS: ConnectionProvider[] = ["SPOTIFY", "STEAM", "TWITCH", "RIOT"];

/** Recusa provedor desconhecido OU sem adaptador. Devolve `null` para barrar. */
function validar(bruto: unknown): ConnectionProvider | null {
  if (typeof bruto !== "string") return null;
  const id = bruto.toUpperCase() as ConnectionProvider;
  if (!VALIDOS.includes(id) || !provedor(id)) return null;
  return id;
}

export async function desconectarConexaoAction(
  providerBruto: string,
): Promise<ActionResult> {
  try {
    const session = await requireUser();
    const id = validar(providerBruto);
    if (!id) return fail("Provedor invalido");

    await desconectar(session.user.id, id);
    revalidatePath("/app");
    return ok(undefined);
  } catch (error) {
    return toActionError(error);
  }
}

export async function definirVisibilidadeConexaoAction(
  providerBruto: string,
  patch: { showOnProfile?: boolean; showAsStatus?: boolean },
): Promise<ActionResult> {
  try {
    const session = await requireUser();
    const id = validar(providerBruto);
    if (!id) return fail("Provedor invalido");

    const limpo: { showOnProfile?: boolean; showAsStatus?: boolean } = {};
    if (typeof patch.showOnProfile === "boolean") {
      limpo.showOnProfile = patch.showOnProfile;
    }
    if (typeof patch.showAsStatus === "boolean") {
      limpo.showAsStatus = patch.showAsStatus;
    }
    if (Object.keys(limpo).length === 0) return fail("Nada para mudar");

    await definirVisibilidadeDaConexao(session.user.id, id, limpo);
    revalidatePath("/app");
    return ok(undefined);
  } catch (error) {
    return toActionError(error);
  }
}
