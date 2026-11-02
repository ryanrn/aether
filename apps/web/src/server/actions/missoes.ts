"use server";

import { revalidatePath } from "next/cache";
import { flagLigada } from "@aether/access";
import {
  formatarMoedas,
  type ActionResult,
  type MissaoDaPessoa,
  type MissaoNoPainel,
} from "@aether/shared";
import { requireUser, sessaoDaEquipe } from "../guards";
import { writeAudit } from "../audit";
import {
  ajustarMissao,
  catalogoDeMissoes,
  MissaoIncompleta,
  MissaoJaResgatada,
  MissaoNaoEncontrada,
  missoesDe,
  resgatarMissao,
} from "../services/missoes";
import { fail, ok, toActionError } from "./action-result";

/** As missoes da pessoa, com o progresso do periodo atual. */
export async function minhasMissoesAction(): Promise<ActionResult<MissaoDaPessoa[]>> {
  try {
    const session = await requireUser();
    return ok(await missoesDe(session.user.id));
  } catch (error) {
    return toActionError(error);
  }
}

/** Resgata a recompensa de uma missao concluida. Devolve o saldo novo. */
export async function resgatarMissaoAction(
  missaoId: unknown,
): Promise<ActionResult<{ saldo: number; recompensa: number }>> {
  try {
    const session = await requireUser();
    // Missao paga moedas da loja: com a loja fechada, nao ha o que resgatar.
    if (!(await flagLigada("loja_de_cosmeticos"))) return fail("Nao encontrado");
    if (typeof missaoId !== "string" || !missaoId) return fail("Missão inválida");

    const r = await resgatarMissao(session.user.id, missaoId);
    revalidatePath("/app/loja");
    return ok(r);
  } catch (error) {
    if (error instanceof MissaoNaoEncontrada) return fail("Missão não encontrada.");
    if (error instanceof MissaoIncompleta) return fail("Essa missão ainda não foi concluída.");
    if (error instanceof MissaoJaResgatada) return fail("Você já resgatou essa missão neste período.");
    return toActionError(error);
  }
}

/** Painel da equipe: o catalogo inteiro, ativas e inativas. */
export async function catalogoDeMissoesAction(): Promise<ActionResult<MissaoNoPainel[]>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    return ok(await catalogoDeMissoes());
  } catch (error) {
    return toActionError(error);
  }
}

const LIMITE_META = 100_000;
const LIMITE_RECOMPENSA = 10_000;

/** Painel da equipe: ajustar meta, recompensa, ou ligar/desligar. */
export async function ajustarMissaoAction(
  missaoId: unknown,
  dados: { meta?: unknown; recompensa?: unknown; ativa?: unknown },
): Promise<ActionResult<MissaoNoPainel[]>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    if (typeof missaoId !== "string" || !missaoId) return fail("Missão inválida");

    const limpo: { meta?: number; recompensa?: number; ativa?: boolean } = {};
    if (dados.meta !== undefined) {
      const n = Number(dados.meta);
      if (!Number.isInteger(n) || n < 1 || n > LIMITE_META) {
        return fail("A meta precisa ser um número inteiro maior que zero.", "meta");
      }
      limpo.meta = n;
    }
    if (dados.recompensa !== undefined) {
      const n = Number(dados.recompensa);
      if (!Number.isInteger(n) || n < 1 || n > LIMITE_RECOMPENSA) {
        return fail(
          `A recompensa precisa ser de 1 a ${formatarMoedas(LIMITE_RECOMPENSA)}.`,
          "recompensa",
        );
      }
      limpo.recompensa = n;
    }
    if (dados.ativa !== undefined) {
      if (typeof dados.ativa !== "boolean") return fail("Valor inválido");
      limpo.ativa = dados.ativa;
    }

    await ajustarMissao(missaoId, limpo);
    await writeAudit({
      serverId: null,
      actorId: sessao.user.id,
      action: "global.missao_ajustada",
      targetType: "missao",
      targetId: missaoId,
      metadata: limpo,
    });
    return ok(await catalogoDeMissoes());
  } catch (error) {
    if (error instanceof MissaoNaoEncontrada) return fail("Missão não encontrada.");
    return toActionError(error);
  }
}
