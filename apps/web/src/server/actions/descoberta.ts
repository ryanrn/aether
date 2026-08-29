"use server";

import { revalidatePath } from "next/cache";
import {
  ajustesDeVitrineSchema,
  buscaDeComunidadeSchema,
  type ActionResult,
  type ComunidadeNaVitrine,
} from "@aether/shared";
import { requirePermission, requireUser } from "../guards";
import {
  entrarEmComunidade,
  lerAjustesDeVitrine,
  listarVitrine,
  salvarAjustesDeVitrine,
} from "../services/descoberta";
import { fail, ok, toActionError } from "./action-result";

/**
 * Explorar comunidades.
 *
 * Todas exigem sessao: a vitrine e curadoria da nossa comunidade, e nao ha
 * razao para servi-la a quem nem conta tem — deixar aberta seria escolher ser
 * raspado.
 */

export async function listarVitrineAction(
  categoria: string | null,
  busca: string,
): Promise<ActionResult<{ comunidades: ComunidadeNaVitrine[] }>> {
  try {
    const sessao = await requireUser();

    const termo = buscaDeComunidadeSchema.safeParse(busca);
    if (!termo.success) return fail("Busca muito longa");

    const comunidades = await listarVitrine(sessao.user.id, {
      categoria,
      busca: termo.data,
    });
    return ok({ comunidades });
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Entra num servidor da vitrine.
 *
 * NAO recebe convite nenhum: quem autoriza e o proprio servidor, por estar
 * publico. O servico recusa qualquer id que nao esteja — inclusive respondendo
 * "nao encontrado" para servidor privado, e nao "voce nao pode".
 */
export async function entrarNaComunidadeAction(
  serverId: string,
): Promise<ActionResult<{ jaEra: boolean }>> {
  try {
    const sessao = await requireUser();

    const resultado = await entrarEmComunidade(sessao.user.id, serverId);
    if (!resultado.ok) {
      return fail(
        resultado.motivo === "banido"
          ? "Voce nao pode entrar nesta comunidade."
          : "Nao encontrado",
      );
    }

    // O trilho lateral vive no layout: sem isto o servidor novo so aparece
    // depois de a pessoa recarregar a pagina na mao.
    revalidatePath("/app", "layout");
    return ok({ jaEra: resultado.jaEra });
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Liga ou desliga a vitrine para um servidor, e ajusta o que aparece no card.
 *
 * Exige `MANAGE_SERVER` — a mesma permissao de trocar nome e icone. Colocar o
 * servidor numa vitrine publica e uma decisao do mesmo peso: muda como o
 * servidor e visto de fora.
 *
 * `oficial` NAO entra aqui de proposito. Selo que o proprio interessado se da
 * nao vale nada; quem marca e a equipe, por script.
 */
export async function salvarVitrineAction(
  serverId: string,
  publico: boolean,
  descricao: string,
  categoria: string | null,
): Promise<ActionResult<undefined>> {
  try {
    await requirePermission(serverId, "MANAGE_SERVER");

    const validado = ajustesDeVitrineSchema.safeParse({
      publico,
      descricao,
      categoria,
    });
    if (!validado.success) {
      return fail(validado.error.issues[0]?.message ?? "Ajustes invalidos");
    }

    await salvarAjustesDeVitrine(serverId, validado.data);
    revalidatePath("/app", "layout");
    return ok(undefined);
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Os ajustes de vitrine do servidor, para a tela de configuracoes desenhar.
 *
 * Existe como action, e nao como prop vinda do servidor, para a secao da
 * vitrine ser autocontida: passar quatro campos novos por tres camadas de
 * componente so para desenhar um interruptor faria cada camada saber de algo
 * que nao lhe diz respeito.
 */
export async function lerVitrineAction(serverId: string): Promise<
  ActionResult<{
    publico: boolean;
    descricao: string;
    categoria: string | null;
    oficial: boolean;
  }>
> {
  try {
    await requirePermission(serverId, "MANAGE_SERVER");
    const ajustes = await lerAjustesDeVitrine(serverId);
    if (!ajustes) return fail("Nao encontrado");
    return ok({
      publico: ajustes.publico,
      descricao: ajustes.descricao ?? "",
      categoria: ajustes.categoria,
      oficial: ajustes.oficial,
    });
  } catch (error) {
    return toActionError(error);
  }
}
