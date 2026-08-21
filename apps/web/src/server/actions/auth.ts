"use server";

import { redirect } from "next/navigation";
import { prisma } from "@aether/db";
import {
  loginSchema,
  registerSchema,
  type ActionResult,
} from "@aether/shared";
import { hashPassword, verifyPassword } from "../auth/password";
import { clientKey, rateLimit } from "../auth/rate-limit";
import { createSession, destroySession } from "../auth/session";
import { fail, toActionError } from "./action-result";

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
    const limit = rateLimit(await clientKey("register"), 5, 10 * 60_000);
    if (!limit.ok) {
      return fail(
        `Muitas tentativas. Aguarde ${limit.retryAfter}s antes de tentar de novo.`,
      );
    }

    const parsed = registerSchema.safeParse({
      username: formData.get("username"),
      displayName: formData.get("displayName"),
      email: formData.get("email"),
      password: formData.get("password"),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(issue?.message ?? "Dados invalidos", String(issue?.path[0] ?? ""));
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
      },
      select: { id: true },
    });

    await createSession(user.id);
  } catch (error) {
    return toActionError(error);
  }

  // redirect() lanca internamente — precisa ficar fora do try/catch.
  redirect("/app");
}

export async function loginAction(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const limit = rateLimit(await clientKey("login"), 10, 5 * 60_000);
    if (!limit.ok) {
      return fail(
        `Muitas tentativas de login. Aguarde ${limit.retryAfter}s.`,
      );
    }

    const parsed = loginSchema.safeParse({
      identifier: formData.get("identifier"),
      password: formData.get("password"),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(issue?.message ?? "Dados invalidos", String(issue?.path[0] ?? ""));
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

  redirect("/app");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
