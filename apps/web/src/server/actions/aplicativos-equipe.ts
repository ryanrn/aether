"use server";

import type { ActionResult } from "@aether/shared";
import { log } from "@aether/shared/log";
import { sessaoDaEquipe } from "../guards";
import { writeAudit } from "../audit";
import {
  definirAplicacaoBloqueada,
  listarAplicacoesParaEquipe,
  type AppNoPainelDaEquipe,
} from "../services/aplicativos";
import { fail, ok, toActionError } from "./action-result";

/**
 * Kill switch de aplicacao (bot) abusiva — a partir do Painel da equipe.
 *
 * `Application.blockedAt` ja existia no schema e ja era imposto em tres
 * lugares (token de bot, gateway de bot, instalacao) — mas nao existia
 * NENHUMA tela nem action pra acionar. So a equipe: `sessaoDaEquipe()`,
 * "Nao encontrado" pra quem nao e.
 */

export async function listarAplicacoesParaEquipeAction(
  busca?: string,
): Promise<ActionResult<AppNoPainelDaEquipe[]>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    return ok(await listarAplicacoesParaEquipe(busca));
  } catch (error) {
    return toActionError(error);
  }
}

export async function definirAplicacaoBloqueadaAction(
  id: string,
  bloquear: boolean,
): Promise<ActionResult<undefined>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    if (typeof id !== "string" || !id) return fail("Aplicacao invalida");

    const alvo = await definirAplicacaoBloqueada(id, bloquear === true);
    if (!alvo) return fail("Nao encontrado");

    log.warn(
      bloquear ? "equipe.aplicacao_bloqueada" : "equipe.aplicacao_desbloqueada",
      bloquear ? "aplicacao bloqueada pela equipe" : "aplicacao desbloqueada pela equipe",
      { por: sessao.user.id, aplicacaoId: id, nome: alvo.name },
    );
    await writeAudit({
      serverId: null,
      actorId: sessao.user.id,
      action: bloquear
        ? "global.aplicacao_bloqueada"
        : "global.aplicacao_desbloqueada",
      targetType: "application",
      targetId: id,
      metadata: { nome: alvo.name },
    });
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}
