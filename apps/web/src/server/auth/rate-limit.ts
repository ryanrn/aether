import "server-only";

import { headers } from "next/headers";
import { limitarJanelaDeslizante, readRedisConfig } from "@aether/shared";

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
    return await limitarJanelaDeslizante(config, key, limit, windowMs);
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
