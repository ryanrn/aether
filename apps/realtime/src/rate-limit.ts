/**
 * Token bucket em memoria, por chave.
 *
 * Validar o conteudo da mensagem nao impede volume: sem isto, um cliente
 * malicioso enche a tabela `Message` num laco. O bucket permite rajada curta
 * — digitar rapido e legitimo — e corta o fluxo continuo.
 *
 * A CHAVE PRECISA SER A IDENTIDADE, NAO A CONEXAO. Chavear pelo id do socket
 * — como era ate aqui — parece certo e nao e: nada impede a mesma pessoa de
 * abrir cinquenta sockets com o mesmo cookie, e cada um estreia com um balde
 * cheio. O limite vira `50 x capacity`, e some. Pior, `forget()` no disconnect
 * transformava reconectar em zerar o balde: bastava um ciclo de socket para
 * recomecar do zero. Por isso quem chama passa `userId`, e por isso nao ha
 * mais `forget` no disconnect.
 *
 * Sem `forget`, o mapa precisa se limpar sozinho — senao cada usuario que
 * passou pelo processo fica na memoria para sempre. Um balde CHEIO nao carrega
 * informacao nenhuma: ele e indistinguivel de uma chave que nunca existiu.
 * Entao chave cheia e ociosa pode sumir sem mudar decisao alguma.
 *
 * Mesma limitacao do rate limit do app web: vive no processo. Com uma
 * instancia funciona; escalar horizontalmente pede Redis. A interface foi
 * desenhada para essa troca ser um swap de implementacao.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/** De quanto em quanto tempo varremos chaves cheias e paradas. */
const SWEEP_INTERVAL_MS = 60_000;

export interface RateLimiter {
  /**
   * Consome um token. `false` significa recusar a acao.
   *
   * A chave deve identificar a PESSOA (userId), nunca a conexao: ver o
   * comentario no topo do arquivo.
   */
  take(key: string): boolean;
  /**
   * Esquece a chave.
   *
   * Nao chame no disconnect com chave de usuario — seria dar um balde novo a
   * cada reconexao. Existe para teste e para limpeza deliberada.
   */
  forget(key: string): void;
  /** Quantas chaves estao vivas. So para teste e diagnostico. */
  size(): number;
}

export function createRateLimiter({
  capacity,
  refillPerSecond,
  now = Date.now,
}: {
  capacity: number;
  refillPerSecond: number;
  /** Injetavel para teste poder avancar o tempo sem esperar de verdade. */
  now?: () => number;
}): RateLimiter {
  const buckets = new Map<string, Bucket>();
  let lastSweep = now();

  /** Quanto tempo um balde vazio leva para encher de novo. */
  const fullRefillMs = (capacity / refillPerSecond) * 1000;

  function sweep(agora: number): void {
    for (const [key, bucket] of buckets) {
      const elapsed = agora - bucket.updatedAt;
      // Cheio ha pelo menos um ciclo inteiro: nao ha estado a preservar.
      if (elapsed >= fullRefillMs) buckets.delete(key);
    }
    lastSweep = agora;
  }

  return {
    take(key) {
      const agora = now();

      if (agora - lastSweep >= SWEEP_INTERVAL_MS) sweep(agora);

      const bucket = buckets.get(key);

      if (!bucket) {
        buckets.set(key, { tokens: capacity - 1, updatedAt: agora });
        return true;
      }

      const elapsedSeconds = (agora - bucket.updatedAt) / 1000;
      bucket.tokens = Math.min(
        capacity,
        bucket.tokens + elapsedSeconds * refillPerSecond,
      );
      bucket.updatedAt = agora;

      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    },

    forget(key) {
      buckets.delete(key);
    },

    size() {
      return buckets.size;
    },
  };
}
