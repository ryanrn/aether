/**
 * Campainha opcional via Open Cloud (MessagingService).
 *
 * O long polling ja entrega em ~1s. Isto derruba para ~200-400ms em jogo
 * PUBLICADO (nao funciona no Studio, que nao recebe MessagingService de fora).
 *
 * DECISAO: a mensagem NAO carrega a acao, so avisa "tem coisa nova ate o seq N".
 * O jogo responde puxando da fila normal. Dois motivos:
 *
 * - MessagingService tem limite de 1 KB por mensagem e cota por minuto. Uma
 *   rajada de live estoura os dois, e mensagem perdida viraria acao perdida.
 * - Com um caminho de entrega so (a fila), nao existe o bug de ordem: push e
 *   polling entregando a mesma acao duas vezes, ou fora de ordem.
 *
 * Perder a campainha custa uma volta do long polling. Perder a acao custaria a
 * interacao da pessoa.
 */

const COALESCE_MS = 500;
const TIMEOUT_MS = 4_000;

export interface Doorbell {
  ring(universeId: string, gameId: string, seq: number): void;
  stop(): void;
}

export function createDoorbell(apiKey: string | null): Doorbell {
  if (!apiKey) {
    return { ring: () => undefined, stop: () => undefined };
  }

  /** Uma campainha pendente por jogo: rajada de 40 comentarios = 1 toque. */
  const pending = new Map<string, { universeId: string; seq: number }>();
  let timer: NodeJS.Timeout | null = null;

  async function flush(): Promise<void> {
    timer = null;
    const batch = [...pending.entries()];
    pending.clear();
    for (const [gameId, { universeId, seq }] of batch) {
      const url =
        `https://apis.roblox.com/messaging-service/v1/universes/${universeId}` +
        `/topics/tiktok-bridge`;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "x-api-key": apiKey!, "content-type": "application/json" },
          // A API embrulha a string; o jogo recebe `message` como texto.
          body: JSON.stringify({ message: JSON.stringify({ g: gameId, s: seq }) }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) {
          console.warn(`[push] ${gameId}: HTTP ${response.status} — seguindo so com polling`);
        }
      } catch (error) {
        console.warn(
          `[push] ${gameId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return {
    ring(universeId, gameId, seq) {
      pending.set(gameId, { universeId, seq });
      if (timer) return;
      timer = setTimeout(() => void flush(), COALESCE_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearTimeout(timer);
    },
  };
}
