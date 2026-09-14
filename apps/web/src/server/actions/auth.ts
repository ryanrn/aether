"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { prisma } from "@aether/db";
import {
  loginSchema,
  registerSchema,
  VERSAO_DOS_TERMOS,
  type ActionResult,
} from "@aether/shared";
import {
  flagLigada,
  criarTokenDeVerificacao,
  PENDENTE_2FA_COOKIE,
  PENDENTE_2FA_TTL_SECONDS,
  signPendente2faToken,
  verifyPendente2faToken,
} from "@aether/access";
import { log } from "@aether/shared/log";
import { hashPassword, verifyPassword } from "../auth/password";
import { clientKey, rateLimit } from "../auth/rate-limit";
import { createSession, destroySession } from "../auth/session";
import { verificarCodigoDeLogin } from "../services/totp";
import { sanitizeNextPath } from "@/lib/next-path";
import { verificarTurnstile } from "../turnstile";
import { emailDeVerificacao, enviarEmail } from "../email";
import { fail, ok, toActionError } from "./action-result";

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
      select: { id: true, displayName: true },
    });

    // `email` e o do formulario (nao-nulo), o mesmo que acabou de ser gravado.
    await iniciarVerificacaoDeEmail({ ...user, email });
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
  _prev: ActionResult<{ precisa2fa: true } | undefined> | null,
  formData: FormData,
): Promise<ActionResult<{ precisa2fa: true } | undefined>> {
  try {
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

    // Por IP: impede varrer muitas contas de um so lugar.
    const porIp = await rateLimit(await clientKey("login"), 10, 5 * 60_000, {
      failClosed: true,
    });
    if (!porIp.ok) {
      return fail(`Muitas tentativas de login. Aguarde ${porIp.retryAfter}s.`);
    }
    /**
     * Por CONTA: sem isto, forca bruta distribuida (varios IPs) contra UMA
     * conta especifica so esbarrava no custo do scrypt — nunca no rate
     * limit, que so olhava o IP. Mesmo padrao de `reset-email` em
     * password-reset.ts: chave pelo identificador digitado, nao pelo usuario
     * resolvido — nao revela se a conta existe, e roda antes da consulta.
     */
    const porConta = await rateLimit(
      `login-conta:${identifier}`,
      8,
      10 * 60_000,
      { failClosed: true },
    );
    if (!porConta.ok) {
      return fail(
        `Muitas tentativas para esta conta. Aguarde ${porConta.retryAfter}s.`,
      );
    }

    const user = await prisma.user.findFirst({
      where: { OR: [{ username: identifier }, { email: identifier }] },
      select: { id: true, passwordHash: true, totpHabilitadoEm: true },
    });

    // Mensagem generica de proposito: nao revelamos se o usuario existe.
    const invalid = fail("Usuario ou senha invalidos");
    if (!user) {
      // Custo constante: evita descobrir usuarios validos pelo tempo de resposta.
      await verifyPassword(parsed.data.password, "scrypt$16384$8$1$AAAA$AAAA");
      return invalid;
    }

    // Conta sem hash de senha (identidade de bot/webhook) nao loga. Mesma
    // resposta generica — nao revelamos que o nome existe.
    if (!user.passwordHash) return invalid;

    const valid = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!valid) return invalid;

    /**
     * Senha certa, mas a conta tem 2FA — a sessao de verdade so nasce depois
     * do segundo fator. `precisa2fa` troca a tela do formulario sem
     * completar o login; o cookie curto (10min) e quem prova, na proxima
     * action, que a senha ja foi confirmada.
     */
    if (user.totpHabilitadoEm !== null) {
      const token = await signPendente2faToken(user.id);
      const cookieStore = await cookies();
      cookieStore.set(PENDENTE_2FA_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: PENDENTE_2FA_TTL_SECONDS,
      });
      return ok({ precisa2fa: true });
    }

    await createSession(user.id);
  } catch (error) {
    return toActionError(error);
  }

  // `next` do form — link de convite preservado pelo login (Cenario 4).
  redirect(sanitizeNextPath(formData.get("next")?.toString()));
}

/**
 * Segundo passo do login quando a conta tem 2FA — chamado com o codigo do
 * autenticador (ou um codigo de backup) depois que `loginAction` ja
 * confirmou a senha e devolveu `precisa2fa`.
 */
export async function verificarTotpDoLoginAction(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const cookieStore = await cookies();
    const userId = await verifyPendente2faToken(
      cookieStore.get(PENDENTE_2FA_COOKIE)?.value,
    );
    if (!userId) {
      return fail("Sessao de verificacao expirada. Faca login de novo.");
    }

    // Por conta: um codigo de 6 digitos tem so 10^6 valores — sem isto, o
    // segundo fator inteiro seria forca-bruta-avel em poucos minutos.
    const limite = await rateLimit(`totp-login:${userId}`, 8, 10 * 60_000, {
      failClosed: true,
    });
    if (!limite.ok) {
      return fail(`Muitas tentativas. Aguarde ${limite.retryAfter}s.`);
    }

    const codigo = formData.get("codigo")?.toString() ?? "";
    if (!codigo.trim()) return fail("Digite o codigo.", "codigo");

    const resultado = await verificarCodigoDeLogin(userId, codigo);
    if (!resultado.ok) return fail(resultado.error, "codigo");

    cookieStore.delete(PENDENTE_2FA_COOKIE);
    await createSession(userId);
  } catch (error) {
    return toActionError(error);
  }

  redirect(sanitizeNextPath(formData.get("next")?.toString()));
}

/** Volta pro formulario de senha — descarta o cookie de 2FA pendente. */
export async function cancelarLogin2faAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(PENDENTE_2FA_COOKIE);
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
