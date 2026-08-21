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
