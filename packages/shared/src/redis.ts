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

/**
 * O resultado de aplicar um limite: passou, e em quantos segundos tentar de
 * novo se nao passou.
 */
export interface ResultadoDeLimite {
  ok: boolean;
  retryAfter: number;
}

/**
 * Janela deslizante com sorted set.
 *
 * Um script Lua, e nao uma sequencia de comandos, porque precisa ser ATOMICO:
 * com comandos separados, duas tentativas simultaneas leem o mesmo contador
 * antes de qualquer uma escrever, e as duas passam — que e exatamente a
 * corrida que um limite de tentativas existe para impedir.
 *
 * A tentativa RECUSADA nao entra no conjunto. Se entrasse, insistir empurraria
 * a liberacao para sempre adiante, e quem errou a senha ficaria trancado
 * enquanto continuasse tentando. E o detalhe mais facil de quebrar aqui, e o
 * mais dificil de notar depois.
 */
const JANELA_DESLIZANTE_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = 1
  if oldest[2] then
    retry = math.ceil((tonumber(oldest[2]) + window - now) / 1000)
    if retry < 1 then retry = 1 end
  end
  return {0, retry}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, 0}
`;

/**
 * Aplica a janela deslizante no Redis.
 *
 * MORA AQUI, e nao dentro do app web, para que o script de verificacao possa
 * exercitar o MESMO codigo que roda em producao — inclusive a serializacao dos
 * argumentos, que transforma tudo em texto e depende do `tonumber` do Lua para
 * voltar a ser numero. Um duble de `fetch` nunca prova essa parte.
 *
 * Nao trata erro: quem chama decide entre liberar e recusar, e essa escolha
 * muda conforme o que esta sendo protegido.
 */
export async function limitarJanelaDeslizante(
  config: RedisConfig,
  chave: string,
  limite: number,
  janelaMs: number,
  agora: number = Date.now(),
): Promise<ResultadoDeLimite> {
  const membro = `${agora}-${Math.random().toString(16).slice(2)}`;
  const resultado = (await redisEval(
    config,
    JANELA_DESLIZANTE_LUA,
    [`ratelimit:${chave}`],
    [agora, janelaMs, limite, membro],
  )) as [number, number];

  return { ok: resultado[0] === 1, retryAfter: Number(resultado[1]) || 0 };
}

/**
 * `SET key 1 NX PX ttl` — grava so se ainda nao existir, e expira sozinho.
 *
 * Uma operacao atomica: duas instancias apresentando o mesmo ticket ao mesmo
 * tempo, so uma escreve. Um GET seguido de SET teria a corrida exata que o
 * consumo unico existe para impedir.
 */
const CONSUMIR_TICKET_LUA = `
if redis.call('SET', KEYS[1], '1', 'NX', 'PX', ARGV[1]) then
  return 1
end
return 0
`;

/**
 * Consome um ticket. `true` na primeira vez, `false` em toda repeticao.
 *
 * Como no limite acima, o erro nao e tratado aqui: no gateway a duvida "este
 * ticket ja foi usado?" precisa ser fail-CLOSED, enquanto o rate limit e
 * fail-open. Deixar a decisao com quem chama e o que permite as duas.
 */
export async function consumirTicketUnico(
  config: RedisConfig,
  jti: string,
  ttlMs: number,
): Promise<boolean> {
  const resultado = await redisEval(
    config,
    CONSUMIR_TICKET_LUA,
    [`ticket:${jti}`],
    [ttlMs],
  );
  return resultado === 1;
}
