/**
 * Token bucket em memoria, por chave (usamos o id do socket).
 *
 * Validar o conteudo da mensagem nao impede volume: sem isto, um cliente
 * malicioso enche a tabela `Message` num laco. O bucket permite rajada curta
 * — digitar rapido e legitimo — e corta o fluxo continuo.
 *
 * Mesma limitacao do rate limit do app web: vive no processo. Com uma
 * instancia funciona; escalar horizontalmente pede Redis. A interface foi
 * desenhada para essa troca ser um swap de implementacao.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimiter {
  /** Consome um token. `false` significa recusar a acao. */
  take(key: string): boolean;
  /** Libera a memoria da chave (chamar no disconnect). */
  forget(key: string): void;
}

export function createRateLimiter({
  capacity,
  refillPerSecond,
}: {
  capacity: number;
  refillPerSecond: number;
}): RateLimiter {
  const buckets = new Map<string, Bucket>();

  return {
    take(key) {
      const now = Date.now();
      const bucket = buckets.get(key);

      if (!bucket) {
        buckets.set(key, { tokens: capacity - 1, updatedAt: now });
        return true;
      }

      const elapsedSeconds = (now - bucket.updatedAt) / 1000;
      bucket.tokens = Math.min(
        capacity,
        bucket.tokens + elapsedSeconds * refillPerSecond,
      );
      bucket.updatedAt = now;

      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    },

    forget(key) {
      buckets.delete(key);
    },
  };
}
