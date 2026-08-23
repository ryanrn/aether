/**
 * Cliente minimo do Upstash Redis, por HTTP.
 *
 * Por que HTTP e nao um cliente Redis de verdade: o app web roda em funcoes
 * SERVERLESS na Vercel. Conexao TCP persistente ali e problema conhecido —
 * cada cold start abre uma conexao nova e o pool do servidor estoura. A API
 * REST do Upstash e stateless: uma requisicao, uma resposta, sem pool.
 *
 * Por que sem o SDK `@upstash/redis`: ele faz exatamente isto, e o projeto ja
 * fala com dois servicos externos por `fetch` cru (o gateway em
 * `realtime-notify.ts` e o Storage em `storage.ts`). Uma dependencia a menos
 * para auditar, e a mesma casa de estilo.
 *
 * Mora em @aether/shared porque o gateway tambem vai precisar (consumo unico
 * de ticket) — e a regra de "uma copia so" vale para infraestrutura tambem.
 */

export interface RedisConfig {
  url: string;
  token: string;
}

/**
 * Le a configuracao do ambiente. `null` quando nao ha Redis configurado — e
 * um estado LEGITIMO, nao um erro: quem chama decide o que fazer sem ele
 * (tipicamente cair para memoria). Mesma escolha do LiveKit no gateway.
 */
export function readRedisConfig(): RedisConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

export class RedisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedisError";
  }
}

/**
 * Executa um script Lua no servidor Redis.
 *
 * Lua e nao um pipeline de comandos de proposito: rate limit e consumo de
 * ticket precisam ser ATOMICOS. Num pipeline, duas requisicoes concorrentes
 * podem ler o mesmo estado antes de qualquer uma escrever — que e exatamente
 * a corrida que um limite de tentativas existe para impedir.
 */
export async function redisEval(
  config: RedisConfig,
  script: string,
  keys: string[],
  args: (string | number)[],
  timeoutMs = 3000,
): Promise<unknown> {
  const response = await fetch(`${config.url}/eval`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([script, keys.length, ...keys, ...args.map(String)]),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new RedisError(
      `HTTP ${response.status}: ${await response.text().catch(() => "")}`,
    );
  }

  const body = (await response.json()) as { result?: unknown; error?: string };
  if (body.error) throw new RedisError(body.error);
  return body.result;
}
