/**
 * Contencao de volume. Tres mecanismos, tres problemas diferentes:
 *
 * 1. `TokenBucket` por espectador — uma pessoa nao enche a fila sozinha, mas
 *    ainda pode mandar uma rajada curta (digitar rapido e legitimo).
 * 2. `TokenBucket` global — a live inteira nao passa de N acoes/segundo. Sem
 *    ele, 3 mil pessoas educadas somam mais que o servidor do Roblox aguenta.
 * 3. `Dedupe` — o mesmo comentario repetido em segundos vira uma acao so. E o
 *    caso do "spam de bot" e do dedo travado no enter.
 *
 * Tudo em memoria e proposital: a fila tambem e. Se o processo cai, a live
 * continua e os proximos comentarios recomecam do zero — replay de comentario
 * velho seria pior que perder.
 *
 * Toda estrutura aqui se limpa sozinha. Chave de espectador so cresce durante a
 * live (milhares de pessoas), e balde CHEIO e indistinguivel de chave que nunca
 * existiu — entao pode sumir sem mudar decisao nenhuma.
 */

const SWEEP_INTERVAL_MS = 30_000;

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface TokenBucket {
  take(key: string): boolean;
  size(): number;
  stop(): void;
}

export function createTokenBucket({
  capacity,
  refillPerSecond,
  now = Date.now,
}: {
  capacity: number;
  refillPerSecond: number;
  now?: () => number;
}): TokenBucket {
  const buckets = new Map<string, Bucket>();

  const sweep = setInterval(() => {
    const current = now();
    for (const [key, bucket] of buckets) {
      const refilled = bucket.tokens + ((current - bucket.updatedAt) / 1000) * refillPerSecond;
      if (refilled >= capacity) buckets.delete(key);
    }
  }, SWEEP_INTERVAL_MS);
  sweep.unref?.();

  return {
    take(key) {
      const current = now();
      const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: current };
      const refilled = Math.min(
        capacity,
        bucket.tokens + ((current - bucket.updatedAt) / 1000) * refillPerSecond,
      );
      if (refilled < 1) {
        // Guarda o estado mesmo recusando: senao o relogio nunca avanca.
        buckets.set(key, { tokens: refilled, updatedAt: current });
        return false;
      }
      buckets.set(key, { tokens: refilled - 1, updatedAt: current });
      return true;
    },
    size: () => buckets.size,
    stop: () => clearInterval(sweep),
  };
}

export interface Dedupe {
  /** `true` = e novidade. `false` = repetiu dentro da janela. */
  accept(key: string): boolean;
  size(): number;
  stop(): void;
}

export function createDedupe({
  windowMs,
  now = Date.now,
}: {
  windowMs: number;
  now?: () => number;
}): Dedupe {
  const seen = new Map<string, number>();

  const sweep = setInterval(() => {
    const cutoff = now() - windowMs;
    for (const [key, at] of seen) if (at < cutoff) seen.delete(key);
  }, SWEEP_INTERVAL_MS);
  sweep.unref?.();

  return {
    accept(key) {
      const current = now();
      const previous = seen.get(key);
      if (previous !== undefined && current - previous < windowMs) return false;
      seen.set(key, current);
      return true;
    },
    size: () => seen.size,
    stop: () => clearInterval(sweep),
  };
}

/**
 * Cooldown por (pessoa, comando). Separado do balde de proposito: o balde
 * limita QUANTO alguem fala, o cooldown limita a frequencia de UM efeito caro.
 * "bomba" a cada 6 segundos por pessoa nao pesa; a cada 200ms derruba o
 * servidor mesmo com o balde permitindo.
 */
export interface Cooldown {
  ready(key: string, cooldownMs: number): boolean;
  size(): number;
  stop(): void;
}

export function createCooldown({ now = Date.now }: { now?: () => number } = {}): Cooldown {
  const last = new Map<string, number>();
  /** Maior cooldown ja visto: abaixo disso nada pode ser varrido com seguranca. */
  let widest = 0;

  const sweep = setInterval(() => {
    const cutoff = now() - widest;
    for (const [key, at] of last) if (at < cutoff) last.delete(key);
  }, SWEEP_INTERVAL_MS);
  sweep.unref?.();

  return {
    ready(key, cooldownMs) {
      if (cooldownMs <= 0) return true;
      if (cooldownMs > widest) widest = cooldownMs;
      const current = now();
      const previous = last.get(key);
      if (previous !== undefined && current - previous < cooldownMs) return false;
      last.set(key, current);
      return true;
    },
    size: () => last.size,
    stop: () => clearInterval(sweep),
  };
}
