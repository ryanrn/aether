import {
  loadSession,
  resolveSessionToken,
  verifySocketTicket,
  SESSION_COOKIE,
  SOCKET_TICKET_TTL_SECONDS,
} from "@aether/access";
import type { SocketData } from "@aether/shared";

/**
 * Autenticacao do handshake WebSocket.
 *
 * O gateway NAO tem login proprio. Ele aceita duas provas de identidade, e as
 * duas terminam na mesma validacao de sessao no banco:
 *
 *  1. TICKET (producao). O app emite, sob demanda, um ticket curto e de uso
 *     unico. E o caminho que atravessa dominios diferentes — em producao o app
 *     fica em um dominio e o gateway em outro, e o navegador nao envia cookie
 *     SameSite=Lax para outro site.
 *
 *  2. COOKIE (desenvolvimento). Em localhost app e gateway sao o mesmo site,
 *     entao o cookie chega sozinho e nao ha ticket a buscar.
 *
 * Em ambos os casos a linha `Session` e conferida no banco: revogar login
 * derruba o acesso pelos dois caminhos.
 *
 * Por que nao afrouxar o cookie para SameSite=None: isso jogaria fora a
 * protecao contra CSRF que o Lax da de graca em TODA a aplicacao, para
 * resolver um problema de um unico endpoint.
 */

export interface SocketCredentials {
  cookieHeader: string | undefined;
  ticket: unknown;
}

/** Parser minimo de Cookie: evita uma dependencia para ler um unico valor. */
export function readCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const raw = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/**
 * Tickets ja usados, lembrados apenas enquanto poderiam ser reaproveitados.
 *
 * E o que torna o uso unico real em vez de uma promessa: sem isto, um ticket
 * capturado valeria por todo o seu tempo de vida. Funciona porque ha uma
 * instancia de gateway; ao escalar horizontalmente isto vai para o Redis,
 * junto com presenca e rate limit.
 */
const usedTickets = new Map<string, number>();
let lastSweep = Date.now();

function consumeTicket(jti: string): boolean {
  const now = Date.now();

  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [id, expiresAt] of usedTickets) {
      if (expiresAt < now) usedTickets.delete(id);
    }
  }

  if (usedTickets.has(jti)) return false;
  usedTickets.set(jti, now + SOCKET_TICKET_TTL_SECONDS * 1000);
  return true;
}

/**
 * Retorna os dados da conexao, ou `null` para recusar o handshake.
 * Recusar sem detalhe e intencional: o cliente nao precisa saber se a prova
 * era invalida, expirada, revogada ou ja usada.
 */
export async function authenticateHandshake(
  credentials: SocketCredentials,
): Promise<SocketData | null> {
  const session = await resolveCredentials(credentials);
  if (!session) return null;

  const { email: _email, ...user } = session.user;
  return { userId: user.id, sessionId: session.sessionId, user };
}

async function resolveCredentials({ cookieHeader, ticket }: SocketCredentials) {
  if (typeof ticket === "string" && ticket.length > 0) {
    const claims = await verifySocketTicket(ticket);
    if (!claims) return null;
    // O consumo acontece ANTES de ir ao banco: um ticket repetido nao deve nem
    // gerar consulta.
    if (!consumeTicket(claims.jti)) return null;
    return loadSession(claims.sid, claims.sub);
  }

  const token = readCookie(cookieHeader, SESSION_COOKIE);
  return resolveSessionToken(token);
}
