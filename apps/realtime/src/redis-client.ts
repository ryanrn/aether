import { Redis } from "ioredis";
import { log } from "@aether/shared/log";

/**
 * Clientes Redis do gateway (fase 7c-2) — TCP de verdade via `ioredis`, e nao
 * a API REST do Upstash que o app web usa.
 *
 * E uma conexao TCP de verdade (`redis://`/`rediss://`), NAO a API REST do
 * Upstash que `@aether/shared/redis` usa para o rate limit do app web. A REST
 * serve bem uma funcao serverless (sem pool para estourar), mas nao da
 * pub/sub — e o adapter do Socket.IO e o estado de presenca/voz PRECISAM de
 * pub/sub e de comandos como SADD/HSET, que a API REST nao oferece numa
 * conexao persistente. O gateway e processo de vida longa (Fly, nao
 * serverless), entao o problema que motivou a REST no app web nao existe
 * aqui — TCP e o caminho certo. Upstash entrega os dois: a URL de conexao
 * Redis normal fica na aba "Redis Connect" do console, separada da aba
 * "REST API".
 *
 * TRES conexoes, nao uma: o adapter do Socket.IO exige um cliente dedicado
 * para PUBLISH e outro para SUBSCRIBE — uma conexao em modo subscribe no
 * Redis so aceita comandos de subscribe, nada mais. `main` e para tudo que
 * `state-redis.ts` faz (HSET, SADD, EVAL...), fora do par do adapter.
 *
 * `null` quando `REDIS_URL` nao esta configurada — mesmo padrao do LiveKit em
 * `env.ts`: ausencia e estado legitimo, e quem usa decide o que fazer sem
 * ela. LIDO DIRETO DE `process.env`, e NAO de `./env`: aquele modulo lanca no
 * import se `AUTH_SECRET`/`DATABASE_URL` faltarem, e `state.ts` (que importa
 * este arquivo) precisa continuar carregavel sem infraestrutura nenhuma —
 * `tests/unit/voice-activity.test.ts` testa o estado em memoria exatamente
 * assim, sem `.env` nenhum.
 */
function createClients(): { main: Redis; pub: Redis; sub: Redis } | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  /**
   * `maxRetriesPerRequest: null` no par do adapter e a propria recomendacao
   * do `@socket.io/redis-adapter`: sem isso, um comando em voo durante uma
   * reconexao pode rejeitar em vez de esperar, e o adapter trata isso pior
   * que uma espera.
   */
  const main = new Redis(redisUrl);
  const pub = new Redis(redisUrl);
  const sub = new Redis(redisUrl, { maxRetriesPerRequest: null });

  for (const [nome, cliente] of [
    ["main", main],
    ["pub", pub],
    ["sub", sub],
  ] as const) {
    cliente.on("error", (erro) => {
      log.warn("gateway.redis.erro", `redis(${nome}) erro`, {
        err: erro,
        cliente: nome,
      });
    });
  }

  return { main, pub, sub };
}

export const redisClients = createClients();
