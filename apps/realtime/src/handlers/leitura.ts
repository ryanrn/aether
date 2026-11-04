import { log } from "@aether/shared/log";
import type { AetherServer, AetherSocket } from "../types";
import { createRateLimiter } from "../rate-limit";
import { calcularNaoLidas, marcarLeitura } from "../leitura";

/**
 * `read:mark` e o `read:state` da conexao.
 *
 * Limitador proprio, e nao o balde do chat: marcar leitura nao e escrever
 * mensagem, e o cliente ja espaca as marcacoes (uma a cada 2 s por conversa).
 * O teto aqui so impede um laco de transformar leitura em carga de banco.
 */
const limiter = createRateLimiter({ capacity: 20, refillPerSecond: 4 });

export function registerLeituraHandlers(
  io: AetherServer,
  socket: AetherSocket,
): void {
  const { userId } = socket.data;

  socket.on("read:mark", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;
    if (!payload || typeof payload !== "object" || !limiter.take(userId)) {
      respond({ ok: false });
      return;
    }
    try {
      const p = payload as { conversationId?: unknown; messageId?: unknown };
      respond({ ok: await marcarLeitura(io, userId, p.conversationId, p.messageId) });
    } catch (erro) {
      log.error("gateway.leitura.marcar", "read:mark falhou", {
        err: erro,
        userId,
        socketId: socket.id,
      });
      respond({ ok: false });
    }
  });
}

/**
 * Manda as nao lidas iniciais. Sem `await` no handshake, como as salas: o
 * resto da conexao nao depende disto. Se falhar, o cliente so fica com o
 * contador em memoria de antes — degradacao, nao quebra.
 */
export function enviarNaoLidasIniciais(socket: AetherSocket): void {
  const { userId } = socket.data;
  void calcularNaoLidas(userId)
    .then((estado) => socket.emit("read:state", estado))
    .catch((erro) => {
      log.error("gateway.leitura.estado", "não calculei as não lidas", {
        err: erro,
        userId,
        socketId: socket.id,
      });
    });
}
