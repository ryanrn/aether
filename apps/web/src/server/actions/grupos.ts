"use server";

import type { ActionResult } from "@aether/shared";
import { requireUser } from "../guards";
import {
  listarGruposDosMeusServidores,
  type GrupoPorJogo,
} from "../services/grupos";
import { ok, toActionError } from "./action-result";

/**
 * Re-le a lista de grupos. Usada pelo auto-refresh da tela de Grupos (fase 2,
 * estagio 4a): a tela nao esta nas salas desses servidores, entao nao ha socket
 * ao vivo — ela pergunta de novo a cada ~20s.
 */
export async function listarGruposAction(): Promise<
  ActionResult<GrupoPorJogo[]>
> {
  try {
    const session = await requireUser();
    return ok(await listarGruposDosMeusServidores(session.user.id));
  } catch (error) {
    return toActionError(error);
  }
}
