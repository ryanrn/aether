import { SignJWT, jwtVerify, type JWTPayload } from "jose";

/**
 * Emissao/verificacao do JWT de sessao.
 *
 * Este modulo e propositalmente livre de Node APIs e de Prisma: roda no
 * middleware do Next (Edge runtime), nos server components e dentro do gateway
 * Socket.IO — que autentica o handshake com exatamente o mesmo token.
 *
 * Por isso ele e exposto tambem como subpath (`@aether/access/tokens`): quem
 * roda no Edge importa daqui sem arrastar o cliente Prisma junto.
 */

export const SESSION_COOKIE = "aether_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 dias

export interface SessionClaims extends JWTPayload {
  /** id da linha Session no banco (permite revogacao) */
  sid: string;
  /** id do usuario */
  sub: string;
}

let cachedKey: Uint8Array | null = null;

function secretKey(): Uint8Array {
  if (cachedKey) return cachedKey;
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET ausente ou curto demais. Gere um valor com pelo menos 32 caracteres na raiz do monorepo (.env)",
    );
  }
  cachedKey = new TextEncoder().encode(secret);
  return cachedKey;
}

export async function signSessionToken(
  payload: Pick<SessionClaims, "sid" | "sub">,
): Promise<string> {
  return new SignJWT({ sid: payload.sid })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer("aether")
    .setAudience("aether-app")
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: "aether",
      audience: "aether-app",
    });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
      return null;
    }
    return payload as SessionClaims;
  } catch {
    return null;
  }
}

/**
 * Token de "senha certa, aguardando o segundo fator" — o estado entre a
 * senha e a sessao de verdade, quando a conta tem TOTP ligado.
 *
 * NAO E SESSAO: nao cria linha em `Session`, dura so 10 minutos, e nunca
 * pode ser aceito onde uma sessao real seria — a `audience` diferente
 * ("aether-2fa-pendente" em vez de "aether-app") garante isso pelo proprio
 * `jwtVerify` (aud errada = token rejeitado), sem precisar de campo extra
 * pra checar manualmente. Sem tabela no banco de proposito: e efemero, usado
 * uma vez em minutos, e o limite de tentativas mora no rate limit por
 * usuario — nao ha o que revogar que valha o custo de uma tabela nova.
 */
export const PENDENTE_2FA_COOKIE = "aether_2fa_pendente";
export const PENDENTE_2FA_TTL_SECONDS = 60 * 10; // 10 minutos

export async function signPendente2faToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer("aether")
    .setAudience("aether-2fa-pendente")
    .setExpirationTime(`${PENDENTE_2FA_TTL_SECONDS}s`)
    .sign(secretKey());
}

/** Devolve o id do usuario, ou `null` se o token faltar/expirar/for invalido. */
export async function verifyPendente2faToken(
  token: string | undefined,
): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: "aether",
      audience: "aether-2fa-pendente",
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
