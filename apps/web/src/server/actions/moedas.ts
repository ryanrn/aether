"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@aether/db";
import { flagLigada } from "@aether/access";
import {
  CONCESSAO_MAXIMA,
  formatarMoedas,
  type ActionResult,
  type Carteira,
} from "@aether/shared";
import { requireUser, sessaoDaEquipe } from "../guards";
import { writeAudit } from "../audit";
import {
  carteiraDe,
  comprarCosmetico,
  concederMoedas,
  ConcessaoInvalida,
  ItemNaoAVenda,
  JaPossui,
  resgatarCosmetico,
  SaldoInsuficiente,
} from "../services/moedas";
import { fail, ok, toActionError } from "./action-result";

/**
 * Moedas da loja: comprar, ver a carteira, e a equipe conceder.
 *
 * A regra mora em `services/moedas.ts`; aqui so a entrada (sessao, flag da
 * loja, formato) e a traducao dos erros para a tela. Comprar fica atras da
 * mesma flag que abre a loja (`loja_de_cosmeticos`): com a loja fechada, nao
 * ha o que comprar.
 */

/** Compra um cosmetico com moedas. Devolve o saldo que sobrou. */
export async function comprarCosmeticoAction(
  cosmeticId: unknown,
): Promise<ActionResult<{ saldo: number }>> {
  try {
    const session = await requireUser();
    if (!(await flagLigada("loja_de_cosmeticos"))) return fail("Nao encontrado");
    if (typeof cosmeticId !== "string" || !cosmeticId) {
      return fail("Cosmético inválido");
    }

    const r = await comprarCosmetico(
      session.user.id,
      session.user.plano,
      cosmeticId,
    );
    revalidatePath("/app/loja");
    return ok(r);
  } catch (error) {
    if (error instanceof ItemNaoAVenda) {
      return fail("Esse item não está à venda para você.");
    }
    if (error instanceof JaPossui) return fail("Esse item já é seu.");
    if (error instanceof SaldoInsuficiente) {
      return fail(
        `Faltam ${formatarMoedas(error.preco - error.saldo)} para este item.`,
      );
    }
    return toActionError(error);
  }
}

/**
 * Resgata um item gratis de colecao com prazo (vira seu para sempre). Resgatar
 * de novo responde sucesso: o que a pessoa queria — ter o item — ja e verdade.
 */
export async function resgatarCosmeticoAction(
  cosmeticId: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const session = await requireUser();
    if (!(await flagLigada("loja_de_cosmeticos"))) return fail("Nao encontrado");
    if (typeof cosmeticId !== "string" || !cosmeticId) {
      return fail("Cosmético inválido");
    }
    try {
      await resgatarCosmetico(session.user.id, session.user.plano, cosmeticId);
    } catch (erro) {
      if (!(erro instanceof JaPossui)) throw erro;
    }
    revalidatePath("/app/loja");
    return ok();
  } catch (error) {
    if (error instanceof ItemNaoAVenda) {
      return fail("Esse item não está disponível para resgate.");
    }
    return toActionError(error);
  }
}

/** Saldo e extrato da propria pessoa. */
export async function carteiraAction(): Promise<ActionResult<Carteira>> {
  try {
    const session = await requireUser();
    return ok(await carteiraDe(session.user.id));
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * A equipe da (valor positivo) ou tira (negativo) moedas de alguem, por nome
 * de usuario. Fica na auditoria global, com valor, nota e saldo resultante.
 */
export async function concederMoedasAction(
  username: unknown,
  valor: unknown,
  nota: unknown,
): Promise<ActionResult<{ saldo: number }>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");

    if (typeof username !== "string" || !username.trim()) {
      return fail("Informe o nome de usuário", "username");
    }
    const n = typeof valor === "number" ? valor : Number(valor);
    if (!Number.isInteger(n) || n === 0 || Math.abs(n) > CONCESSAO_MAXIMA) {
      return fail(
        `Valor inválido: um número inteiro diferente de zero, até ${CONCESSAO_MAXIMA.toLocaleString("pt-BR")}.`,
        "valor",
      );
    }
    const texto =
      typeof nota === "string" && nota.trim() ? nota.trim().slice(0, 200) : null;

    const alvo = await prisma.user.findUnique({
      where: { username: username.trim() },
      select: { id: true, kind: true },
    });
    // Bot e webhook nao tem carteira que faca sentido.
    if (!alvo || alvo.kind !== "HUMAN") {
      return fail("Usuário não encontrado", "username");
    }

    const r = await concederMoedas({
      atorId: sessao.user.id,
      userId: alvo.id,
      valor: n,
      nota: texto,
    });

    await writeAudit({
      serverId: null,
      actorId: sessao.user.id,
      action: "global.moedas_concedidas",
      targetType: "user",
      targetId: alvo.id,
      metadata: { valor: n, nota: texto, saldoDepois: r.saldo },
    });
    return ok(r);
  } catch (error) {
    if (error instanceof SaldoInsuficiente) {
      return fail(
        `A pessoa tem só ${formatarMoedas(error.saldo)}; não dá para tirar ${formatarMoedas(error.preco)}.`,
        "valor",
      );
    }
    if (error instanceof ConcessaoInvalida) return fail("Valor inválido", "valor");
    return toActionError(error);
  }
}
