import { loadSession } from "@aether/access";
import { log } from "@aether/shared/log";
import type { AetherServer, AetherSocket } from "./types";

/**
 * Revalidacao de sessao em conexao ja aberta.
 *
 * O handshake confere a linha `Session` uma unica vez (ver auth.ts). Depois
 * disso o socket seguia valendo para sempre: logout, revogacao ou expiracao
 * nao derrubavam quem ja estava conectado — a escrita revalida PERMISSAO a
 * cada acao, mas nunca revalidava se a SESSAO em si ainda existia.
 *
 * Por que polling, e nao avisar o gateway a partir de cada ponto que revoga
 * sessao (logout, troca de senha futura, etc.): logout e raro, e ensinar cada
 * ponto que pode invalidar sessao a chamar o gateway e mais superficie de
 * erro do que um intervalo que reusa `loadSession()` — a MESMA funcao que o
 * handshake ja usa. Duas copias da regra de sessao divergem, e sessao
 * divergente e falha de autenticacao.
 *
 * 30s: rapido o bastante para o logout ter efeito em tempo razoavel, devagar
 * o bastante para nao martelar o Postgres — nesta escala (grupo de amigos,
 * nao milhares de sockets) uma consulta a cada 30s por sessao unica e
 * desprezivel.
 *
 * `SESSION_GUARD_INTERVAL_MS` existe SO para o CI (fase 7d): o
 * `verify-phase7b` precisa esperar um ciclo inteiro do guarda, e 30s por
 * script multiplica o tempo da suite de integracao. Sem a variavel o valor e
 * exatamente o de sempre — producao nunca a define.
 */
const REVALIDATE_INTERVAL_MS = Number(
  process.env.SESSION_GUARD_INTERVAL_MS ?? 30_000,
);

export function startSessionGuard(io: AetherServer): () => void {
  const timer = setInterval(() => {
    void revalidateAll(io).catch((error) => {
      log.error("gateway.sessao.revalidacao", "revalidação de sessão falhou", {
        err: error,
      });
    });
  }, REVALIDATE_INTERVAL_MS);

  return () => clearInterval(timer);
}

async function revalidateAll(io: AetherServer): Promise<void> {
  // Agrupado por sessionId: duas abas da mesma pessoa dividem a mesma linha
  // `Session`, entao uma consulta serve para as duas em vez de uma por socket.
  const bySession = new Map<
    string,
    { userId: string; sockets: AetherSocket[] }
  >();

  for (const socket of io.sockets.sockets.values()) {
    const { sessionId, userId } = socket.data;
    const bucket = bySession.get(sessionId) ?? { userId, sockets: [] };
    bucket.sockets.push(socket);
    bySession.set(sessionId, bucket);
  }

  if (bySession.size === 0) return;

  await Promise.all(
    [...bySession.entries()].map(async ([sessionId, { userId, sockets }]) => {
      const session = await loadSession(sessionId, userId).catch(() => null);
      if (session) return;

      for (const socket of sockets) {
        socket.emit("session:revoked");
        socket.disconnect(true);
      }
    }),
  );
}
