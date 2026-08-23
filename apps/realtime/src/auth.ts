import {
  loadSession,
  resolveSessionToken,
  verifySocketTicket,
  SESSION_COOKIE,
  SOCKET_TICKET_TTL_SECONDS,
} from "@aether/access";
import { readRedisConfig, redisEval, type SocketData } from "@aether/shared";

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
 * capturado valeria por todo o seu tempo de vida.
 *
 * Com Redis configurado, a lembranca e COMPARTILHADA entre instancias — que e
 * o que faz o uso unico continuar valendo com mais de uma maquina de gateway.
 * Sem Redis, cai para memoria: correto com uma instancia (o caso de hoje),
 * e a segunda maquina reabriria a janela de replay.
 */
const usedTickets = new Map<string, number>();
let lastSweep = Date.now();

function consumeTicketInMemory(jti: string): boolean {
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
 * `SET key 1 NX PX ttl` — grava so se ainda nao existir, e expira sozinho.
 * Uma operacao atomica: duas instancias apresentando o mesmo ticket ao mesmo
 * tempo, so uma escreve. Um GET seguido de SET teria a corrida exata que o
 * consumo unico existe para impedir.
 */
const CONSUME_TICKET_LUA = `
if redis.call('SET', KEYS[1], '1', 'NX', 'PX', ARGV[1]) then
  return 1
end
return 0
`;

async function consumeTicket(jti: string): Promise<boolean> {
  const config = readRedisConfig();
  if (!config) return consumeTicketInMemory(jti);

  try {
    const result = await redisEval(
      config,
      CONSUME_TICKET_LUA,
      [`ticket:${jti}`],
      [SOCKET_TICKET_TTL_SECONDS * 1000],
    );
    return result === 1;
  } catch (error) {
    /**
     * Fail-CLOSED, ao contrario do rate limit. Aqui a duvida e "este ticket ja
     * foi usado?", e responder "acho que nao" com o Redis fora do ar abriria a
     * janela de replay que este codigo existe para fechar. O custo de recusar
     * e uma reconexao: o cliente ja pede um ticket novo a cada tentativa.
     */
    console.error("[gateway] Redis indisponivel ao consumir ticket:", error);
    return false;
  }
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
    if (!(await consumeTicket(claims.jti))) return null;
    return loadSession(claims.sid, claims.sub);
  }

  const token = readCookie(cookieHeader, SESSION_COOKIE);
  return resolveSessionToken(token);
}
