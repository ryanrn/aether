"use server";

import { revalidatePath } from "next/cache";
import { ehEquipe } from "@aether/access";
import {
  sugerirJogoSchema,
  type ActionResult,
  type JogoNaFila,
  type StatusDeJogo,
} from "@aether/shared";
import { requireUser } from "../guards";
import {
  contarJogosPendentes,
  listarFilaDeJogos,
  revisarJogo,
  sugerirJogo,
} from "../services/jogos";
import { fail, ok, toActionError } from "./action-result";

/**
 * A biblioteca de jogos da comunidade.
 *
 * DUAS PORTAS COM PUBLICOS DIFERENTES, no mesmo arquivo porque tratam do mesmo
 * assunto: qualquer pessoa logada SUGERE, so a equipe REVISA.
 *
 * O `userId` nunca vem do formulario, em nenhuma das duas: sai do cookie de
 * sessao. Aceitar do cliente seria deixar alguem sugerir em nome de outro — e
 * a sugestao guarda quem a fez justamente para haver a quem responsabilizar.
 */

/**
 * Barra quem nao e da equipe.
 *
 * Responde como se a funcionalidade nao existisse, e nao "voce nao pode": e a
 * regra do projeto — nao revelamos existencia de recurso. Quem chutar o nome
 * da action recebe a mesma coisa que receberia de uma action inventada.
 */
async function exigirEquipe() {
  const sessao = await requireUser();
  if (!ehEquipe(sessao)) return null;
  return sessao;
}

/** Qualquer pessoa logada pode ensinar um jogo ao app. */
export async function sugerirJogoAction(
  executavel: string,
  nome: string,
): Promise<ActionResult<{ status: StatusDeJogo; jaSugerido: boolean }>> {
  try {
    const sessao = await requireUser();

    const validado = sugerirJogoSchema.safeParse({ executavel, nome });
    if (!validado.success) {
      return fail(validado.error.issues[0]?.message ?? "Sugestao invalida");
    }

    const resultado = await sugerirJogo(
      sessao.user.id,
      validado.data.executavel,
      validado.data.nome,
    );
    return ok(resultado);
  } catch (error) {
    return toActionError(error);
  }
}

export async function listarFilaAction(
  status: StatusDeJogo = "PENDENTE",
): Promise<ActionResult<{ fila: JogoNaFila[]; pendentes: number }>> {
  try {
    const sessao = await exigirEquipe();
    if (!sessao) return fail("Nao encontrado");

    const [fila, pendentes] = await Promise.all([
      listarFilaDeJogos(status),
      contarJogosPendentes(),
    ]);
    return ok({ fila, pendentes });
  } catch (error) {
    return toActionError(error);
  }
}

export async function revisarJogoAction(
  jogoId: string,
  status: "APROVADO" | "RECUSADO",
  nome?: string,
): Promise<ActionResult<{ aplicado: boolean }>> {
  try {
    const sessao = await exigirEquipe();
    if (!sessao) return fail("Nao encontrado");

    const aplicado = await revisarJogo(jogoId, sessao.user.id, status, nome);
    /**
     * `false` quando outra pessoa da equipe ja tinha revisado esta linha. Nao
     * e erro — e informacao, e a tela usa para recarregar em vez de insistir.
     */
    revalidatePath("/app", "layout");
    return ok({ aplicado });
  } catch (error) {
    return toActionError(error);
  }
}
