"use server";

import type { ActionResult } from "@aether/shared";
import { PLAN_ORDER, type PlanTier } from "@aether/shared";
import { log } from "@aether/shared/log";
import { sessaoDaEquipe } from "../guards";
import {
  criarChave,
  listarChaves,
  revogarChave,
  type ChaveNaLista,
} from "../services/planos";
import { fail, ok, toActionError } from "./action-result";

/**
 * Gerar, listar e revogar chaves de plano — a partir do Painel da equipe.
 *
 * Antes isto so existia no `scripts/gerar-chave.mjs` (linha de comando, no
 * `.env` de producao). O painel faz o mesmo, com o guard no lugar certo: as
 * tres actions passam por `sessaoDaEquipe()` e respondem "Nao encontrado" para
 * quem nao e da equipe — a mesma regra da fila de jogos e da vitrine.
 *
 * O servico (`criarChave` / `listarChaves` / `revogarChave`) e O MESMO que o
 * script usa. Duas implementacoes divergiriam no formato do codigo ou no
 * hash, e ai uma chave gerada por um caminho nao resgataria pelo outro.
 */

export interface ChaveGerada {
  id: string;
  /** O codigo em claro — so volta AQUI, uma vez. */
  codigo: string;
  tier: PlanTier;
  dias: number | null;
  maxUsos: number;
}

/** Numero opcional dentro de um intervalo; `null` quando o campo veio vazio. */
function inteiroOpcional(
  valor: unknown,
  { min, max }: { min: number; max: number },
): number | null | "invalido" {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) return "invalido";
  return n;
}

export async function gerarChaveAction(entrada: {
  tier: PlanTier;
  /** dias de plano ao resgatar; vazio = sem validade (permanente) */
  dias?: number | string | null;
  /** quantas pessoas podem resgatar (1 = pessoal) */
  maxUsos?: number | string | null;
  /** ate quando a CHAVE aceita resgate; vazio = sem prazo */
  validadeDias?: number | string | null;
  motivo?: string | null;
}): Promise<ActionResult<ChaveGerada>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");

    // FREE nao vira chave — nao ha o que conceder.
    if (!PLAN_ORDER.includes(entrada.tier) || entrada.tier === "FREE") {
      return fail("Escolha Olimpo ou Olimpo Pro.", "tier");
    }

    const dias = inteiroOpcional(entrada.dias, { min: 1, max: 3650 });
    if (dias === "invalido") {
      return fail("Dias de plano: 1 a 3650, ou vazio para permanente.", "dias");
    }

    const maxUsosBruto = inteiroOpcional(entrada.maxUsos, {
      min: 1,
      max: 10000,
    });
    if (maxUsosBruto === "invalido") {
      return fail("Usos: entre 1 e 10000.", "maxUsos");
    }
    const maxUsos = maxUsosBruto ?? 1;

    const validadeDias = inteiroOpcional(entrada.validadeDias, {
      min: 1,
      max: 365,
    });
    if (validadeDias === "invalido") {
      return fail("Validade da chave: 1 a 365 dias, ou vazio.", "validadeDias");
    }

    const motivo =
      typeof entrada.motivo === "string" && entrada.motivo.trim().length > 0
        ? entrada.motivo.trim().slice(0, 120)
        : undefined;

    const chave = await criarChave({
      tier: entrada.tier,
      dias,
      maxUsos,
      validaPorDias: validadeDias,
      criadaPor: `@${sessao.user.username}`,
      motivo,
    });

    return ok({
      id: chave.id,
      codigo: chave.codigo,
      tier: chave.tier,
      dias: chave.dias,
      maxUsos: chave.maxUsos,
    });
  } catch (error) {
    return toActionError(error);
  }
}

export async function listarChavesAction(): Promise<
  ActionResult<ChaveNaLista[]>
> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    return ok(await listarChaves());
  } catch (error) {
    return toActionError(error);
  }
}

export async function revogarChaveAction(
  id: string,
): Promise<ActionResult<ChaveNaLista[]>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    if (typeof id !== "string" || id.length === 0 || id.length > 64) {
      return fail("Chave invalida.");
    }
    const revogada = await revogarChave(id);
    if (revogada) {
      log.info("equipe.chave_revogada", "chave de plano revogada", {
        por: sessao.user.id,
        chaveId: id,
        prefixo: revogada.prefixo,
        tier: revogada.tier,
      });
    }
    return ok(await listarChaves());
  } catch (error) {
    return toActionError(error);
  }
}
