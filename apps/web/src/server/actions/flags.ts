"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@aether/shared";
import { ehChaveDeFlag } from "@aether/shared";
import { definirFlag, lerFlagsParaAdmin, type FlagParaAdmin } from "@aether/access";
import { sessaoDaEquipe } from "../guards";
import { writeAudit } from "../audit";
import { fail, ok, toActionError } from "./action-result";

/**
 * Feature flags / kill switch — so a equipe.
 *
 * `sessaoDaEquipe` devolve `null` (nao lanca) para quem nao e equipe, e a
 * action responde "Nao encontrado": mesma regra do resto do painel, nao
 * confirmamos que a tela existe para quem chutou o nome da action.
 *
 * O rastro de quem virou o que continua tambem no `log.info("flag.alterada",
 * ...)` dentro de `definirFlag` (auditoria nao substitui log estruturado, so
 * soma) — e agora TAMBEM em `AuditLog` (`serverId: null`, migracao
 * `20260913120000_auditoria_global`), pra ficar pesquisavel dentro do
 * proprio painel, nao so no provedor de log externo.
 */

export async function listarFlagsAction(): Promise<
  ActionResult<FlagParaAdmin[]>
> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    return ok(await lerFlagsParaAdmin());
  } catch (error) {
    return toActionError(error);
  }
}

export async function virarFlagAction(
  chave: string,
  ligado: boolean,
): Promise<ActionResult<FlagParaAdmin[]>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");

    if (typeof chave !== "string" || !ehChaveDeFlag(chave)) {
      return fail("Flag desconhecida");
    }
    if (typeof ligado !== "boolean") return fail("Valor invalido");

    await definirFlag(chave, ligado, sessao.user.id);
    await writeAudit({
      serverId: null,
      actorId: sessao.user.id,
      action: "global.flag_alterada",
      targetType: "flag",
      targetId: chave,
      metadata: { ligado },
    });

    // A pagina da equipe e server-rendered; força reler na próxima visita.
    revalidatePath("/app/equipe");
    return ok(await lerFlagsParaAdmin());
  } catch (error) {
    return toActionError(error);
  }
}
