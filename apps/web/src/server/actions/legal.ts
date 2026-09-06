"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@aether/db";
import { VERSAO_DOS_TERMOS, type ActionResult } from "@aether/shared";
import { getSession } from "@/server/auth/session";
import { fail, ok, toActionError } from "./action-result";

/**
 * Registra o aceite dos Termos/Privacidade da versao ATUAL para a conta
 * logada. Chamado pelo modal em `/app` quando `precisaAceitarTermos`.
 */
export async function aceitarTermosAction(): Promise<ActionResult<undefined>> {
  try {
    const session = await getSession();
    if (!session) return fail("Sessao expirada. Entre novamente.");

    await prisma.user.update({
      where: { id: session.user.id },
      data: { aceitouTermosEm: new Date(), termosVersao: VERSAO_DOS_TERMOS },
    });

    revalidatePath("/app", "layout");
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}
