"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@aether/db";
import {
  loginSchema,
  registerSchema,
  VERSAO_DOS_TERMOS,
  type ActionResult,
} from "@aether/shared";
import { flagLigada, criarTokenDeVerificacao } from "@aether/access";
import { log } from "@aether/shared/log";
import { hashPassword, verifyPassword } from "../auth/password";
import { clientKey, rateLimit } from "../auth/rate-limit";
import { createSession, destroySession } from "../auth/session";
import { sanitizeNextPath } from "@/lib/next-path";
import { verificarTurnstile } from "../turnstile";
import { emailDeVerificacao, enviarEmail } from "../email";
import { fail, toActionError } from "./action-result";

/** IP do cliente, para passar ao siteverify do Turnstile. */
async function ipDoCliente(): Promise<string | null> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    null
  );
}

/**
 * Dispara a confirmacao de e-mail — token novo + envio. Nunca lanca: se o
 * envio falhar, a conta ja existe e a pessoa pede reenvio na tela da parede.
 */
async function iniciarVerificacaoDeEmail(user: {
  id: string;
  email: string;
  displayName: string;
}): Promise<void> {
  try {
    const token = await criarTokenDeVerificacao(user.id);
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const link = `${base}/verificar?token=${token}`;
    const { html, texto } = emailDeVerificacao(link, user.displayName);
    const envio = await enviarEmail({
      para: user.email,
      assunto: "Confirme seu e-mail — AETHER",
      html,
      texto,
    });
    if (!envio.ok) {
      log.warn("web.verificacao.envio", "envio da confirmação de e-mail falhou", {
        motivo: envio.motivo,
        userId: user.id,
      });
      if (process.env.NODE_ENV !== "production") {
        console.log("[verificacao] link (so em desenvolvimento):", link);
      }
    }
  } catch (erro) {
    log.error("web.verificacao.iniciar", "não iniciei a verificação de e-mail", {
      err: erro,
      userId: user.id,
    });
  }
}

/**
 * Actions de autenticacao.
 *
 * Todas revalidam a entrada com Zod no servidor — o schema usado no cliente
 * e o mesmo, mas o cliente e apenas conveniencia; a decisao e aqui.
 */

export async function registerAction(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const limit = await rateLimit(await clientKey("register"), 5, 10 * 60_000, {
      failClosed: true,
    });
    if (!limit.ok) {
      return fail(
        `Muitas tentativas. Aguarde ${limit.retryAfter}s antes de tentar de novo.`,
      );
    }

    /**
     * Kill switch de cadastro. Checado depois do rate limit — quem esta
     * martelando a rota continua sendo barrado por ritmo antes de a gente
     * consultar a flag.
     */
    if (!(await flagLigada("registro_aberto"))) {
      return fail("O cadastro de novas contas esta fechado no momento.");
    }

    /**
     * CAPTCHA (Turnstile). Antes de qualquer escrita. Pulado quando
     * `TURNSTILE_SECRET_KEY` nao esta configurada (dev); em producao, um
     * cadastro sem token e um bot que nem tentou o widget.
     */
    const captchaOk = await verificarTurnstile(
      formData.get("turnstileToken")?.toString(),
      await ipDoCliente(),
    );
    if (!captchaOk) {
      return fail("Falha na verificacao anti-robo. Recarregue a pagina e tente de novo.");
    }

    if (formData.get("aceitaTermos") == null) {
      return fail("É preciso aceitar os Termos e a Política de Privacidade.");
    }

    const parsed = registerSchema.safeParse({
      username: formData.get("username"),
      displayName: formData.get("displayName"),
      email: formData.get("email"),
      password: formData.get("password"),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(
        issue?.message ?? "Dados invalidos",
        String(issue?.path[0] ?? ""),
      );
    }

    const { username, displayName, email, password } = parsed.data;
    const usernameLower = username.toLowerCase();

    const existing = await prisma.user.findFirst({
      where: { OR: [{ username: usernameLower }, { email }] },
      select: { username: true, email: true },
    });
    if (existing) {
      return existing.username === usernameLower
        ? fail("Este usuario ja esta em uso", "username")
        : fail("Este e-mail ja esta cadastrado", "email");
    }

    const user = await prisma.user.create({
      data: {
        username: usernameLower,
        displayName,
        email,
        passwordHash: await hashPassword(password),
        aceitouTermosEm: new Date(),
        termosVersao: VERSAO_DOS_TERMOS,
      },
      select: { id: true, email: true, displayName: true },
    });

    await iniciarVerificacaoDeEmail(user);
    await createSession(user.id);
  } catch (error) {
    return toActionError(error);
  }

  // redirect() lanca internamente — precisa ficar fora do try/catch.
  // `next` vem do form (link de convite). A conta entra logada; se o destino
  // for um servidor privado, a parede de "confirme seu e-mail" ainda aparece
  // — mas a associacao ao servidor ja foi criada e ele aparece no trilho.
  redirect(sanitizeNextPath(formData.get("next")?.toString()));
}

export async function loginAction(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const limit = await rateLimit(await clientKey("login"), 10, 5 * 60_000, {
      failClosed: true,
    });
    if (!limit.ok) {
      return fail(`Muitas tentativas de login. Aguarde ${limit.retryAfter}s.`);
    }

    const parsed = loginSchema.safeParse({
      identifier: formData.get("identifier"),
      password: formData.get("password"),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(
        issue?.message ?? "Dados invalidos",
        String(issue?.path[0] ?? ""),
      );
    }

    const identifier = parsed.data.identifier.toLowerCase();
    const user = await prisma.user.findFirst({
      where: { OR: [{ username: identifier }, { email: identifier }] },
      select: { id: true, passwordHash: true },
    });

    // Mensagem generica de proposito: nao revelamos se o usuario existe.
    const invalid = fail("Usuario ou senha invalidos");
    if (!user) {
      // Custo constante: evita descobrir usuarios validos pelo tempo de resposta.
      await verifyPassword(parsed.data.password, "scrypt$16384$8$1$AAAA$AAAA");
      return invalid;
    }

    const valid = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!valid) return invalid;

    await createSession(user.id);
  } catch (error) {
    return toActionError(error);
  }

  // `next` do form — link de convite preservado pelo login (Cenario 4).
  redirect(sanitizeNextPath(formData.get("next")?.toString()));
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
