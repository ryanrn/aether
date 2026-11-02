"use server";

import { revalidatePath } from "next/cache";
import {
  colecaoMetaSchema,
  type ActionResult,
  type ColecaoNoPainel,
} from "@aether/shared";
import { sessaoDaEquipe } from "../guards";
import { writeAudit } from "../audit";
import {
  ColecaoNaoEncontrada,
  ColecaoSlugEmUso,
  criarColecao,
  editarColecao,
  excluirColecao,
  listarColecoes,
} from "../services/colecoes";
import { fail, ok, toActionError } from "./action-result";

/**
 * Cadastro de colecoes da loja — SO A EQUIPE. Quem nao e equipe recebe "Nao
 * encontrado", como o resto do painel. Criar, editar e excluir ficam na
 * auditoria global.
 */

interface EntradaDeColecao {
  nome: unknown;
  slug: unknown;
  descricao?: unknown;
  inicioEm?: unknown;
  fimEm?: unknown;
  destaque?: unknown;
  ativa?: unknown;
  ordem?: unknown;
}

function lerMeta(input: EntradaDeColecao) {
  return colecaoMetaSchema.safeParse(input);
}

function erroDeValidacao(
  parsed: Extract<ReturnType<typeof lerMeta>, { success: false }>,
) {
  const issue = parsed.error.issues[0];
  return fail(issue?.message ?? "Dados invalidos", issue?.path[0]?.toString());
}

/** O que vai para a auditoria: o estado gravado, sem contagem. */
function resumo(c: ColecaoNoPainel) {
  return {
    slug: c.slug,
    nome: c.nome,
    inicioEm: c.inicioEm,
    fimEm: c.fimEm,
    destaque: c.destaque,
    ativa: c.ativa,
  };
}

export async function listarColecoesAction(): Promise<
  ActionResult<ColecaoNoPainel[]>
> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    return ok(await listarColecoes());
  } catch (error) {
    return toActionError(error);
  }
}

export async function criarColecaoAction(
  input: EntradaDeColecao,
): Promise<ActionResult<ColecaoNoPainel>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    const parsed = lerMeta(input);
    if (!parsed.success) return erroDeValidacao(parsed);

    const criada = await criarColecao(parsed.data, sessao.user.id);
    await writeAudit({
      serverId: null,
      actorId: sessao.user.id,
      action: "global.colecao_criada",
      targetType: "colecao",
      targetId: criada.id,
      metadata: resumo(criada),
    });
    revalidatePath("/app/loja");
    return ok(criada);
  } catch (error) {
    if (error instanceof ColecaoSlugEmUso) {
      return fail("Ja existe uma colecao com esse slug", "slug");
    }
    return toActionError(error);
  }
}

export async function editarColecaoAction(
  id: unknown,
  input: EntradaDeColecao,
): Promise<ActionResult<ColecaoNoPainel>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    if (typeof id !== "string" || !id) return fail("Colecao invalida");
    const parsed = lerMeta(input);
    if (!parsed.success) return erroDeValidacao(parsed);

    const editada = await editarColecao(id, parsed.data);
    await writeAudit({
      serverId: null,
      actorId: sessao.user.id,
      action: "global.colecao_editada",
      targetType: "colecao",
      targetId: id,
      metadata: resumo(editada),
    });
    revalidatePath("/app/loja");
    return ok(editada);
  } catch (error) {
    if (error instanceof ColecaoNaoEncontrada) return fail("Nao encontrado");
    return toActionError(error);
  }
}

export async function excluirColecaoAction(
  id: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    if (typeof id !== "string" || !id) return fail("Colecao invalida");

    await excluirColecao(id);
    await writeAudit({
      serverId: null,
      actorId: sessao.user.id,
      action: "global.colecao_excluida",
      targetType: "colecao",
      targetId: id,
    });
    revalidatePath("/app/loja");
    return ok();
  } catch (error) {
    if (error instanceof ColecaoNaoEncontrada) return fail("Nao encontrado");
    return toActionError(error);
  }
}
