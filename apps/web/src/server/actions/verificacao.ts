"use server";

import type { ActionResult } from "@aether/shared";
import { criarTokenDeVerificacao } from "@aether/access";
import { log } from "@aether/shared/log";
import { getSession } from "@/server/auth/session";
import { clientKey, rateLimit } from "@/server/auth/rate-limit";
import { emailDeVerificacao, enviarEmail } from "@/server/email";
import { fail, ok } from "./action-result";

/**
 * Reenvia o e-mail de confirmacao para a conta LOGADA.
 *
 * So funciona para quem esta na propria sessao e ainda nao confirmou — nao
 * aceita e-mail de fora, entao nao vira ferramenta de email-bombing de
 * terceiros. Rate limit por IP mesmo assim: reenviar em laco enche a caixa da
 * propria pessoa.
 */
export async function reenviarVerificacaoAction(): Promise<
  ActionResult<{ enviado: true }>
> {
  const session = await getSession();
  if (!session) return fail("Sessao expirada. Entre novamente.");
  if (session.user.emailVerificadoEm) {
    return ok({ enviado: true }); // ja confirmou — nada a fazer, sem erro
  }

  const limite = await rateLimit(await clientKey("verif-reenvio"), 3, 10 * 60_000, {
    failClosed: true,
  });
  if (!limite.ok) {
    return fail(`Aguarde ${limite.retryAfter}s antes de pedir de novo.`);
  }

  try {
    const token = await criarTokenDeVerificacao(session.user.id);
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const link = `${base}/verificar?token=${token}`;
    const { html, texto } = emailDeVerificacao(link, session.user.displayName);
    const envio = await enviarEmail({
      para: session.user.email,
      assunto: "Confirme seu e-mail — AETHER",
      html,
      texto,
    });
    if (!envio.ok) {
      log.warn("web.verificacao.reenvio", "reenvio da confirmação falhou", {
        motivo: envio.motivo,
        userId: session.user.id,
      });
      if (process.env.NODE_ENV !== "production") {
        console.log("[verificacao] link (so em desenvolvimento):", link);
      }
      return fail("Não consegui enviar agora. Tente de novo em instantes.");
    }
    return ok({ enviado: true });
  } catch (erro) {
    log.error("web.verificacao.reenvio", "erro ao reenviar a confirmação", {
      err: erro,
      userId: session.user.id,
    });
    return fail("Algo deu errado. Tente novamente.");
  }
}
