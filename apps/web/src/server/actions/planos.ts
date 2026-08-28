"use server";

import { loadPlan } from "@aether/access";
import { limitesDoPlano, type PlanLimits, type PlanTier } from "@aether/shared";
import { requireUser } from "../guards";
import {
  ChaveEsgotada,
  ChaveInvalida,
  ChaveJaResgatada,
  ChaveRevogada,
  ChaveVencida,
  resgatarChave,
} from "../services/planos";
import { fail, ok, toActionError } from "./action-result";
import type { ActionResult } from "@aether/shared";

/**
 * O plano de quem esta olhando, e o resgate de chave.
 *
 * SEMPRE DA PROPRIA SESSAO. Nenhuma destas actions aceita um `userId` de fora:
 * quem pergunta pergunta por si, e quem resgata resgata para si. Aceitar o id
 * por parametro deixaria qualquer um consultar o plano alheio — e, no resgate,
 * gastar a chave de outra pessoa.
 */

export interface PlanoNaTela {
  tier: PlanTier;
  limites: PlanLimits;
  /** ISO, ou nulo quando nao vence (concessao) ou e gratuito. */
  expiraEm: string | null;
}

export async function meuPlano(): Promise<ActionResult<PlanoNaTela>> {
  try {
    const session = await requireUser();
    const plano = await loadPlan(session.user.id);
    return ok({
      tier: plano.tier,
      limites: plano.limites,
      expiraEm: plano.expiraEm ? plano.expiraEm.toISOString() : null,
    });
  } catch (error) {
    return toActionError(error);
  }
}

export async function resgatarChaveAction(
  codigo: string,
): Promise<ActionResult<PlanoNaTela>> {
  try {
    const session = await requireUser();

    if (typeof codigo !== "string" || codigo.trim().length === 0) {
      return fail("Digite o codigo da chave.", "codigo");
    }
    /**
     * Teto de tamanho antes de tocar no banco: o codigo tem 20 caracteres, e
     * aceitar um texto de megabytes so para calcular um sha256 seria trabalho
     * de graca para quem quisesse dar.
     */
    if (codigo.length > 64) return fail("Codigo invalido.", "codigo");

    const resgate = await resgatarChave(session.user.id, codigo);

    return ok({
      tier: resgate.tier,
      limites: limitesDoPlano(resgate.tier),
      expiraEm: resgate.expiraEm ? resgate.expiraEm.toISOString() : null,
    });
  } catch (error) {
    /**
     * Cada recusa diz o QUE aconteceu.
     *
     * Diferente do login, aqui nao ha enumeracao a proteger: uma chave e
     * aleatoria entre 10^17, e ninguem descobre que ela existe tentando.
     * Responder sempre "codigo invalido" faria quem tem uma chave revogada
     * tentar dez vezes achando que digitou errado.
     */
    if (error instanceof ChaveInvalida) {
      return fail("Esse codigo nao existe. Confira e tente de novo.", "codigo");
    }
    if (error instanceof ChaveRevogada) {
      return fail("Essa chave foi cancelada.", "codigo");
    }
    if (error instanceof ChaveVencida) {
      return fail("Essa chave passou da validade.", "codigo");
    }
    if (error instanceof ChaveEsgotada) {
      return fail("Essa chave ja foi usada.", "codigo");
    }
    if (error instanceof ChaveJaResgatada) {
      return fail("Voce ja resgatou essa chave.", "codigo");
    }
    return toActionError(error);
  }
}
