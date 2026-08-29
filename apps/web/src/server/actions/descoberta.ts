"use server";

import { revalidatePath } from "next/cache";
import {
  ajustesDeVitrineSchema,
  buscaDeComunidadeSchema,
  type ActionResult,
  type ComunidadeNaVitrine,
  type PedidoDeVitrine,
  type VitrineStatus,
} from "@aether/shared";
import { requirePermission, requireUser } from "../guards";
import {
  contarPedidosPendentes,
  entrarEmComunidade,
  lerAjustesDeVitrine,
  listarPedidosDeVitrine,
  listarVitrine,
  revisarPedidoDeVitrine,
  salvarAjustesDeVitrine,
} from "../services/descoberta";
import { ehEquipe } from "@aether/access";
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
  querAparecer: boolean,
  descricao: string,
  categoria: string | null,
): Promise<ActionResult<{ status: VitrineStatus; voltouParaFila: boolean }>> {
  try {
    await requirePermission(serverId, "MANAGE_SERVER");

    const validado = ajustesDeVitrineSchema.safeParse({
      querAparecer,
      descricao,
      categoria,
    });
    if (!validado.success) {
      return fail(validado.error.issues[0]?.message ?? "Ajustes invalidos");
    }

    const resultado = await salvarAjustesDeVitrine(serverId, validado.data);
    revalidatePath("/app", "layout");
    return ok(resultado);
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * A fila de pedidos de vitrine, e a decisao. So a equipe.
 *
 * Barra respondendo como se nao existisse — a mesma regra da fila de jogos, e
 * pelo mesmo motivo: nao confirmamos a existencia de um painel para quem
 * chutou o nome da action.
 */
async function exigirEquipe() {
  const sessao = await requireUser();
  return ehEquipe(sessao) ? sessao : null;
}

export async function listarPedidosAction(
  status: VitrineStatus = "PENDENTE",
): Promise<ActionResult<{ pedidos: PedidoDeVitrine[]; pendentes: number }>> {
  try {
    const sessao = await exigirEquipe();
    if (!sessao) return fail("Nao encontrado");

    const [pedidos, pendentes] = await Promise.all([
      listarPedidosDeVitrine(status),
      contarPedidosPendentes(),
    ]);
    return ok({ pedidos, pendentes });
  } catch (error) {
    return toActionError(error);
  }
}

export async function revisarPedidoAction(
  serverId: string,
  decisao: "APROVADO" | "RECUSADO",
): Promise<ActionResult<{ aplicado: boolean }>> {
  try {
    const sessao = await exigirEquipe();
    if (!sessao) return fail("Nao encontrado");

    const aplicado = await revisarPedidoDeVitrine(serverId, sessao.user.id, decisao);
    revalidatePath("/app", "layout");
    return ok({ aplicado });
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
    vitrine: VitrineStatus;
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
      vitrine: ajustes.vitrine as VitrineStatus,
      descricao: ajustes.descricao ?? "",
      categoria: ajustes.categoria,
      oficial: ajustes.oficial,
    });
  } catch (error) {
    return toActionError(error);
  }
}
