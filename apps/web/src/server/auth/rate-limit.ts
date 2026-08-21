import "server-only";

import { headers } from "next/headers";

/**
 * Rate limit de janela deslizante em memoria.
 *
 * LIMITACAO CONHECIDA: o estado vive no processo. Com uma unica instancia Node
 * (o caso de dev e do deploy inicial) funciona; ao escalar horizontalmente isso
 * precisa migrar para Redis. A interface abaixo foi desenhada para essa troca
 * ser um swap de implementacao, sem tocar nas actions.
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

export function rateLimit(
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
