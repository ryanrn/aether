import { SignJWT, jwtVerify } from "jose";
import { SESSION_TTL_SECONDS } from "./tokens";

/**
 * Ticket de handshake do WebSocket.
 *
 * Por que existe: o gateway autentica lendo o cookie de sessao, e isso so
 * funciona enquanto app e gateway estao no MESMO site. Em producao eles ficam
 * em dominios diferentes (.vercel.app e .fly.dev) e o navegador simplesmente
 * nao envia um cookie SameSite=Lax para outro site — todo handshake falharia.
 *
 * A alternativa comum e afrouxar o cookie para SameSite=None, o que joga fora
 * a protecao contra CSRF que o Lax da de graca. Em vez disso o app emite, sob
 * demanda, um ticket curto e de uso unico que serve exclusivamente para abrir
 * o socket.
 *
 * Propriedades:
 *  - vida curta: minutos, nao dias;
 *  - publico proprio (`aether-socket`): um ticket nao vale como cookie de
 *    sessao nem o contrario, mesmo compartilhando o segredo;
 *  - `jti` unico, que o gateway consome uma vez so;
 *  - NAO substitui a checagem de sessao: o gateway continua conferindo a linha
 *    `Session` no banco, entao revogar login continua derrubando o acesso.
 *
 * Efeito colateral util: e exatamente o que um aplicativo desktop vai precisar,
 * porque nesse contexto nao ha cookie de site nenhum.
 */

const TICKET_AUDIENCE = "aether-socket";

/**
 * Precisa sobreviver a uma queda de rede: o cliente guarda um ticket em maos
 * para a proxima tentativa de reconexao, e o intervalo entre a queda e a volta
 * pode ser de minutos. Curto demais transformaria toda reconexao em falha.
 */
const TICKET_TTL_SECONDS = 300;

export interface SocketTicketClaims {
  /** id da linha Session — o gateway revalida no banco */
  sid: string;
  /** id do usuario */
  sub: string;
  /** identificador unico do ticket, para consumo unico */
  jti: string;
}

let cachedKey: Uint8Array | null = null;

function secretKey(): Uint8Array {
  if (cachedKey) return cachedKey;
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET ausente ou curto demais. Defina na raiz do monorepo (.env).",
    );
  }
  cachedKey = new TextEncoder().encode(secret);
  return cachedKey;
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signSocketTicket(payload: {
  sid: string;
  sub: string;
}): Promise<string> {
  return new SignJWT({ sid: payload.sid, jti: randomId() })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer("aether")
    .setAudience(TICKET_AUDIENCE)
    .setExpirationTime(`${TICKET_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySocketTicket(
  ticket: string,
): Promise<SocketTicketClaims | null> {
  try {
    const { payload } = await jwtVerify(ticket, secretKey(), {
      issuer: "aether",
      // Sem isto, um cookie de sessao (que dura 30 dias) valeria como ticket.
      audience: TICKET_AUDIENCE,
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.sid !== "string" ||
      typeof payload.jti !== "string"
    ) {
      return null;
    }
    return { sid: payload.sid, sub: payload.sub, jti: payload.jti };
  } catch {
    return null;
  }
}

/** Exposto para o gateway dimensionar por quanto tempo lembrar de um `jti`. */
export const SOCKET_TICKET_TTL_SECONDS = TICKET_TTL_SECONDS;

/** Sanidade: o ticket jamais pode durar o que dura uma sessao. */
if (TICKET_TTL_SECONDS >= SESSION_TTL_SECONDS) {
  throw new Error("O ticket de socket nao pode durar tanto quanto a sessao.");
}
