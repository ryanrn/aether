import "server-only";

import { headers } from "next/headers";
import { readRedisConfig, redisEval } from "@aether/shared";

/**
 * Rate limit de janela deslizante, com dois armazenamentos.
 *
 * Por que dois: o app web roda em funcoes SERVERLESS na Vercel. Contador em
 * memoria ali nao e "funciona com uma instancia" — e nao funciona, ponto:
 * cada invocacao pode cair numa instancia diferente, e cold start zera o que
 * havia. A protecao de forca bruta do login valia muito menos do que a fase 1
 * documentou.
 *
 * Com UPSTASH_REDIS_REST_URL/TOKEN definidos, o contador vive no Redis e vale
 * para todas as instancias. Sem eles, cai para memoria — que continua correto
 * em desenvolvimento (um processo so) e e o que mantem o app subindo sem
 * configuracao nova, igual ao LiveKit no gateway.
 *
 * A janela deslizante e a MESMA nos dois: o backend muda, o comportamento nao.
 */

type Bucket = { hits: number[] };
const buckets = new Map<string, Bucket>();

let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number, windowMs: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** segundos ate liberar, quando bloqueado */
  retryAfter: number;
}

/** Implementacao em memoria. Exportada para o teste comparar os dois backends. */
export function rateLimitInMemory(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now, windowMs);

  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0]!;
    buckets.set(key, bucket);
    return { ok: false, retryAfter: Math.ceil((windowMs - (now - oldest)) / 1000) };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, retryAfter: 0 };
}

/**
 * Janela deslizante em Redis, com sorted set.
 *
 * Um script Lua, e nao uma sequencia de comandos: precisa ser ATOMICO. Com
 * comandos separados, duas tentativas simultaneas leem o mesmo contador antes
 * de qualquer uma escrever, e as duas passam — que e exatamente a corrida que
 * um limite de tentativas existe para impedir.
 *
 * Espelha `rateLimitInMemory` de proposito, incluindo o detalhe que importa:
 * a tentativa RECUSADA nao entra no conjunto. Se entrasse, insistir empurraria
 * a liberacao para sempre adiante, e quem errou a senha ficaria trancado
 * enquanto continuasse tentando.
 */
const SLIDING_WINDOW_LUA = `
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
 * Aplica o limite. Assincrona porque o backend distribuido fala pela rede —
 * o custo de uma ida ao Redis por tentativa de login e irrelevante perto do
 * scrypt que vem logo depois.
 *
 * Se o Redis falhar, PERMITE a acao (fail-open) e registra. E a escolha certa
 * aqui: rate limit e defesa em profundidade, nao a autenticacao em si. Um
 * Redis fora do ar nao pode derrubar o login do produto inteiro — a senha
 * continua sendo verificada normalmente.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const config = readRedisConfig();
  if (!config) return rateLimitInMemory(key, limit, windowMs);

  try {
    const now = Date.now();
    const member = `${now}-${Math.random().toString(16).slice(2)}`;
    const result = (await redisEval(
      config,
      SLIDING_WINDOW_LUA,
      [`ratelimit:${key}`],
      [now, windowMs, limit, member],
    )) as [number, number];

    return { ok: result[0] === 1, retryAfter: Number(result[1]) || 0 };
  } catch (error) {
    console.error("[rate-limit] Redis indisponivel, liberando:", error);
    return { ok: true, retryAfter: 0 };
  }
}

/** Identificador do cliente para o rate limit (IP quando disponivel). */
export async function clientKey(scope: string): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    "local";
  return `${scope}:${ip}`;
}
