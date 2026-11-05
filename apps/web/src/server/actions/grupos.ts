"use server";

import type { ActionResult } from "@aether/shared";
import { requireUser } from "../guards";
import {
  listarGruposDosMeusServidores,
  listarSalasDoHub,
  type GrupoPorJogo,
} from "../services/grupos";
import { estadoDoHub } from "../services/hub";
import { ok, toActionError } from "./action-result";

/**
 * Re-le a lista de grupos. Usada pelo auto-refresh da tela de Grupos (fase 2,
 * estagio 4a): a tela nao esta nas salas desses servidores, entao nao ha socket
 * ao vivo — ela pergunta de novo a cada ~20s.
 */
export async function listarGruposAction(): Promise<
  ActionResult<{ meus: GrupoPorJogo[]; hub: GrupoPorJogo[] | null }>
> {
  try {
    const session = await requireUser();
    const [meus, hub] = await Promise.all([
      listarGruposDosMeusServidores(session.user.id),
      estadoDoHub(session.user.id),
    ]);
    // `null` = sem hub (flag desligada ou nenhum marcado): a secao some.
    return ok({ meus, hub: hub ? await listarSalasDoHub(hub.hubId) : null });
  } catch (error) {
    return toActionError(error);
  }
}
