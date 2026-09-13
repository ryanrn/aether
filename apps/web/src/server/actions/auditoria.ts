"use server";

import type { ActionResult } from "@aether/shared";
import { sessaoDaEquipe } from "../guards";
import {
  listarAuditoriaGlobal,
  type EntradaDeAuditoriaGlobal,
} from "../audit";
import { fail, ok, toActionError } from "./action-result";

/**
 * Auditoria das acoes GLOBAIS da equipe (kill switch, chave de plano,
 * cosmetico, bloqueio de aplicacao, moderacao de usuario/mensagem) — a
 * lacuna que `flags.ts`, `denuncias-tab.tsx` etc. ja documentavam como "sem
 * log de auditoria global ainda". Precisa da migracao
 * `20260913120000_auditoria_global` (torna `AuditLog.serverId` opcional)
 * aplicada antes de devolver linha nenhuma.
 */
export async function listarAuditoriaGlobalAction(): Promise<
  ActionResult<EntradaDeAuditoriaGlobal[]>
> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    return ok(await listarAuditoriaGlobal());
  } catch (error) {
    return toActionError(error);
  }
}
