"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@aether/shared";
import type { AlvoDeDenuncia, StatusDeDenuncia } from "@aether/db";
import { silenciarGlobalmente, tirarSilenciamento } from "@aether/access";
import { log } from "@aether/shared/log";
import { requireUser, sessaoDaEquipe } from "../guards";
import { clientKey, rateLimit } from "../auth/rate-limit";
import { revokeAllSessions } from "../auth/session";
import { desconectarUsuarioDoGateway } from "../realtime-notify";
import { motivoDeDenunciaValido, type DenunciaNaFila } from "@aether/shared";
import {
  apagarMensagemPorModeracao,
  contarDenunciasAbertas,
  criarDenuncia,
  listarDenuncias,
  resolverDenuncia,
} from "../services/denuncia";
import { fail, ok, toActionError } from "./action-result";

const TIPOS: AlvoDeDenuncia[] = ["MENSAGEM", "USUARIO", "SERVIDOR"];

/**
 * Denunciar — QUALQUER conta logada. Rate limit por IP: um bot nao pode
 * afogar a fila.
 */
export async function denunciarAction(input: {
  tipo: string;
  alvoId: string;
  motivo: string;
  detalhe?: string;
}): Promise<ActionResult<{ registrada: true }>> {
  try {
    const session = await requireUser();

    const limite = await rateLimit(await clientKey("denuncia"), 10, 10 * 60_000, {
      failClosed: true,
    });
    if (!limite.ok) {
      return fail(`Muitas denúncias seguidas. Aguarde ${limite.retryAfter}s.`);
    }

    const tipo = input?.tipo as AlvoDeDenuncia;
    if (!TIPOS.includes(tipo)) return fail("Tipo inválido");
    const alvoId = String(input?.alvoId ?? "");
    if (!alvoId) return fail("Alvo inválido");
    if (!motivoDeDenunciaValido(String(input?.motivo ?? "")))
      return fail("Motivo inválido");

    const detalhe = input?.detalhe?.toString().slice(0, 2000).trim() || null;

    await criarDenuncia({
      tipo,
      alvoId,
      motivo: input.motivo,
      detalhe,
      reporterId: session.user.id,
    });

    // Resposta igual para denúncia nova e duplicada — nada a ganhar em
    // distinguir para quem denuncia.
    return ok({ registrada: true });
  } catch (error) {
    return toActionError(error);
  }
}

// ─── daqui para baixo: só equipe ────────────────────────────────────────────

export async function listarDenunciasAction(input?: {
  status?: string;
  before?: string;
}): Promise<ActionResult<{ itens: DenunciaNaFila[]; temMais: boolean }>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");

    const statusPedido = input?.status as StatusDeDenuncia | undefined;
    return ok(
      await listarDenuncias({
        status: statusPedido,
        before: input?.before,
      }),
    );
  } catch (error) {
    return toActionError(error);
  }
}

export async function contarDenunciasAbertasAction(): Promise<
  ActionResult<{ abertas: number }>
> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    return ok({ abertas: await contarDenunciasAbertas() });
  } catch (error) {
    return toActionError(error);
  }
}

export async function resolverDenunciaAction(
  id: string,
  decisao: "RESOLVIDA" | "DESCARTADA",
  nota?: string,
): Promise<ActionResult<undefined>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    if (decisao !== "RESOLVIDA" && decisao !== "DESCARTADA") {
      return fail("Decisão inválida");
    }

    const feito = await resolverDenuncia({
      id: String(id ?? ""),
      status: decisao,
      notaEquipe: nota?.toString().slice(0, 2000).trim() || null,
      resolvidaPor: sessao.user.id,
    });
    if (!feito) return fail("Denúncia não encontrada ou já resolvida");

    log.info("moderacao.denuncia_resolvida", "denúncia resolvida", {
      denunciaId: id,
      decisao,
      por: sessao.user.id,
    });
    revalidatePath("/app/equipe");
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Silenciar globalmente. `dias` nulo = indefinido. Revoga as sessoes E
 * desconecta os sockets — o `socket.data` do gateway congela no handshake,
 * entao sem isso a pessoa continuaria mandando mensagem ate reconectar.
 */
export async function silenciarUsuarioAction(input: {
  userId: string;
  motivo?: string;
  dias?: number | null;
}): Promise<ActionResult<undefined>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");

    const userId = String(input?.userId ?? "");
    if (!userId) return fail("Usuário inválido");
    if (userId === sessao.user.id) return fail("Você não pode silenciar a si mesmo.");

    const dias = input?.dias ?? null;
    const ate =
      dias && dias > 0 ? new Date(Date.now() + dias * 24 * 60 * 60 * 1000) : null;

    await silenciarGlobalmente(userId, {
      porQuem: sessao.user.id,
      motivo: input?.motivo?.toString().slice(0, 500).trim() || null,
      ate,
    });
    await revokeAllSessions(userId);
    await desconectarUsuarioDoGateway(userId);

    log.warn("moderacao.silenciado", "usuário silenciado globalmente", {
      alvo: userId,
      por: sessao.user.id,
      ate: ate?.toISOString() ?? "indefinido",
    });
    revalidatePath("/app/equipe");
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

export async function tirarSilenciamentoAction(
  userId: string,
): Promise<ActionResult<undefined>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    await tirarSilenciamento(String(userId ?? ""));
    log.info("moderacao.silenciamento_tirado", "silenciamento removido", {
      alvo: userId,
      por: sessao.user.id,
    });
    revalidatePath("/app/equipe");
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

export async function apagarMensagemDenunciadaAction(
  messageId: string,
): Promise<ActionResult<undefined>> {
  try {
    const sessao = await sessaoDaEquipe();
    if (!sessao) return fail("Nao encontrado");
    const feito = await apagarMensagemPorModeracao(String(messageId ?? ""));
    if (!feito) return fail("Mensagem não encontrada ou já apagada");
    log.info("moderacao.mensagem_apagada", "mensagem apagada por moderação", {
      messageId,
      por: sessao.user.id,
    });
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}
