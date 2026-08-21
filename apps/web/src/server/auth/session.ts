import "server-only";

import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { prisma } from "@aether/db";
import {
  resolveSessionToken,
  signSessionToken,
  verifySessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type AuthenticatedSession,
} from "@aether/access";

/**
 * Ponte entre o HTTP do Next e a sessao.
 *
 * A regra de "esta sessao vale?" mora em @aether/access, porque o gateway
 * realtime precisa exatamente da mesma resposta. O que sobra aqui e o que so
 * existe no mundo do request: ler e gravar o cookie httpOnly, tirar impressao
 * digital do request e memoizar por render.
 */

export type { AuthenticatedSession };

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  // Guardamos apenas o hash: serve para detectar sessao suspeita sem
  // armazenar o IP em claro.
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

async function requestFingerprint() {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? headerList.get("x-real-ip");
  return {
    userAgent: headerList.get("user-agent")?.slice(0, 255) ?? null,
    ipHash: hashIp(ip ?? null),
  };
}

/** Cria a sessao no banco e grava o cookie assinado. */
export async function createSession(userId: string): Promise<void> {
  const { userAgent, ipHash } = await requestFingerprint();

  const session = await prisma.session.create({
    data: {
      userId,
      userAgent,
      ipHash,
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    },
  });

  const token = await signSessionToken({ sid: session.id, sub: userId });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/**
 * Le a sessao atual. Memoizada por request (React cache) para que varios
 * componentes possam chamar sem multiplicar queries.
 */
export const getSession = cache(
  async (): Promise<AuthenticatedSession | null> => {
    const cookieStore = await cookies();
    return resolveSessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  },
);

/** Revoga a sessao atual e limpa o cookie. */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const claims = await verifySessionToken(token);
    if (claims) {
      await prisma.session
        .updateMany({
          where: { id: claims.sid, revokedAt: null },
          data: { revokedAt: new Date() },
        })
        .catch(() => undefined);
    }
  }
  cookieStore.delete(SESSION_COOKIE);
}

/** Revoga todas as sessoes do usuario (troca de senha, ban, "sair de tudo"). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
