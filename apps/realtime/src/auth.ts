import {
  loadSession,
  resolveSessionToken,
  verifySocketTicket,
  SESSION_COOKIE,
  SOCKET_TICKET_TTL_SECONDS,
} from "@aether/access";
import {
  consumirTicketUnico,
  readRedisConfig,
  type SocketData,
} from "@aether/shared";
import { log } from "@aether/shared/log";

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
 * e a segunda maquina reabriria a janela de replay. O mesmo vale quando o
 * Redis esta configurado mas indisponivel — ver `consumeTicket`.
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

async function consumeTicket(jti: string): Promise<boolean> {
  const config = readRedisConfig();
  if (!config) return consumeTicketInMemory(jti);

  try {
    return await consumirTicketUnico(
      config,
      jti,
      SOCKET_TICKET_TTL_SECONDS * 1000,
    );
  } catch (error) {
    /**
     * Redis fora do ar: cai para a lembranca EM MEMORIA desta instancia, e nao
     * recusa direto (auditoria M5).
     *
     * O fail-closed anterior transformava qualquer soluco do Redis em queda
     * total de conexoes NOVAS — nenhum handshake por ticket passava ate o Redis
     * voltar. Caro demais para o que protege: o ticket ja e de uso unico,
     * assinado, e vive no maximo SOCKET_TICKET_TTL_SEGUNDOS.
     *
     * A memoria local mantem o uso unico REAL dentro desta instancia — que e o
     * unico caso hoje (uma maquina de gateway). Com mais de uma instancia, e
     * so durante a queda do Redis, um ticket capturado poderia ser reusado uma
     * vez em outra instancia dentro da sua janela de ~5 min. Exposicao bem
     * menor que derrubar todo mundo que tenta entrar.
     */
    logarRedisIndisponivel(error);
    return consumeTicketInMemory(jti);
  }
}

/**
 * Um erro por minuto, no maximo: um Redis intermitente encheria o log de linha
 * identica a cada handshake e enterraria o resto.
 */
let ultimoAvisoRedis = 0;
function logarRedisIndisponivel(error: unknown): void {
  const agora = Date.now();
  if (agora - ultimoAvisoRedis < 60_000) return;
  ultimoAvisoRedis = agora;
  log.warn(
    "gateway.ticket.redis_indisponivel",
    "Redis fora ao consumir ticket — caindo para memória local (uso único só vale por instância até o Redis voltar)",
    { err: error },
  );
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
