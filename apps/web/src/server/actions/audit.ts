"use server";

import type { ActionResult } from "@aether/shared";
import { requirePermission } from "../guards";
import { listAuditLog, type AuditEntry } from "../services/audit-log";
import { ok, toActionError } from "./action-result";

/**
 * Pagina seguinte do log de auditoria.
 *
 * A primeira pagina vem no SSR da propria pagina de configuracoes; esta action
 * existe so para o "carregar mais". A permissao e revalidada aqui tambem — a
 * primeira checagem, feita ao renderizar, nao vale para chamadas seguintes.
 */
export async function loadAuditPageAction(
  serverId: string,
  before: string,
): Promise<ActionResult<{ entries: AuditEntry[]; hasMore: boolean }>> {
  try {
    await requirePermission(serverId, "VIEW_AUDIT_LOG");
    const page = await listAuditLog(serverId, { before });
    return ok(page);
  } catch (error) {
    return toActionError(error);
  }
}
