"use server";

import { limitesDoPlano, type ActionResult } from "@aether/shared";
import { loadPlan } from "@aether/access";
import { requireUser } from "../guards";
import {
  AnexoInvalido,
  ArmazenamentoIndisponivel,
  MidiaVisualDesligada,
  SemPlanoParaTamanho,
  autorizarAnexo,
  confirmarAnexo,
  descartarAnexo,
  type AnexoAutorizado,
  type AnexoPronto,
} from "../services/anexos";
import { fail, ok, toActionError } from "./action-result";

/**
 * As tres chamadas do envio de anexo, todas da PROPRIA sessao.
 *
 * Nenhuma aceita `userId` de fora: quem envia envia por si. O id do anexo
 * tambem e sempre conferido contra o dono, e anexo alheio responde o mesmo que
 * anexo inexistente — pela regra de sempre, nao revelamos existencia de
 * recurso.
 */

function formatarBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${Math.round(mb / 1024)} GB` : `${Math.round(mb)} MB`;
}

export async function autorizarAnexoAction(params: {
  nome: string;
  tamanho: number;
  mime: string;
}): Promise<ActionResult<AnexoAutorizado>> {
  try {
    const session = await requireUser();
    const autorizado = await autorizarAnexo({
      userId: session.user.id,
      nome: params?.nome ?? "",
      tamanho: Number(params?.tamanho),
      mime: params?.mime ?? "",
    });
    return ok(autorizado);
  } catch (error) {
    if (error instanceof SemPlanoParaTamanho) {
      /**
       * A recusa diz o LIMITE, e nao so "muito grande".
       *
       * Quem esta no gratuito precisa saber que existe um teto maior — e essa
       * e a unica hora em que falar do plano nao e propaganda, e resposta a
       * uma pergunta que a pessoa acabou de fazer.
       */
      return fail(
        `Esse arquivo passa do limite do seu plano (${formatarBytes(error.limiteBytes)}).`,
        "tamanho",
      );
    }
    if (error instanceof ArmazenamentoIndisponivel) {
      return fail("O armazenamento de arquivos nao esta configurado.");
    }
    if (error instanceof MidiaVisualDesligada) {
      return fail(
        "Envio de imagem e video esta desativado no momento. Texto, link, PDF e audio funcionam.",
        "tamanho",
      );
    }
    if (error instanceof AnexoInvalido) {
      return fail("Arquivo invalido.");
    }
    return toActionError(error);
  }
}

export async function confirmarAnexoAction(params: {
  id: string;
  largura?: number | null;
  altura?: number | null;
}): Promise<ActionResult<AnexoPronto>> {
  try {
    const session = await requireUser();
    const pronto = await confirmarAnexo({
      userId: session.user.id,
      anexoId: String(params?.id ?? ""),
      largura: params?.largura ?? null,
      altura: params?.altura ?? null,
    });
    return ok(pronto);
  } catch (error) {
    if (error instanceof AnexoInvalido) {
      return fail("O arquivo nao chegou inteiro. Tente enviar de novo.");
    }
    return toActionError(error);
  }
}

export async function descartarAnexoAction(
  id: string,
): Promise<ActionResult<undefined>> {
  try {
    const session = await requireUser();
    await descartarAnexo(session.user.id, String(id ?? ""));
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

/** Quanto esta conta pode enviar. A tela usa para recusar antes de subir. */
export async function limiteDeAnexo(): Promise<
  ActionResult<{ maxBytes: number; rotulo: string }>
> {
  try {
    const session = await requireUser();
    const plano = await loadPlan(session.user.id);
    return ok({
      maxBytes: plano.limites.uploadMaxBytes,
      rotulo: limitesDoPlano(plano.tier).rotulo,
    });
  } catch (error) {
    return toActionError(error);
  }
}
