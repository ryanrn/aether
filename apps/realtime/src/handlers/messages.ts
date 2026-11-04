import { prisma } from "@aether/db";
import { estaSilenciado } from "@aether/access";
import {
  toPublicMessage,
  MESSAGE_PAGE_SIZE,
} from "@aether/shared";
import { log } from "@aether/shared/log";
import type { AetherServer, AetherSocket } from "../types";
import { createRateLimiter } from "../rate-limit";
import {
  autorizarConversa,
  enviarMensagem,
  BASE_DE_ARQUIVOS,
  MESSAGE_SELECT,
} from "../enviar-mensagem";
import { apagarMensagem } from "../apagar-mensagem";
import { editarMensagem } from "../editar-mensagem";

/**
 * Chat de texto — os handlers de socket.
 *
 * A ESCRITA em si (silenciamento, autorizacao, transacao, evento) mora em
 * `../enviar-mensagem`, para a REST de bots e o webhook passarem pela mesma
 * porta. Aqui fica so o que e do socket: parsear o payload, aplicar o rate
 * limit por identidade, e o historico.
 *
 * `autorizarConversa` tambem vem de la — `reactions.ts` a usa: quem pode VER o
 * canal pode reagir.
 */

/** Rajada de 8, reposicao de 2/s: digitar rapido passa, laco automatizado nao. */
const limiter = createRateLimiter({ capacity: 8, refillPerSecond: 2 });

/**
 * Le o id da conversa aceitando TAMBEM o nome antigo `channelId`.
 *
 * COMPATIBILIDADE TEMPORARIA. O campo se chamava `channelId` ate as conversas
 * diretas existirem. Entre um deploy e outro (Vercel e Fly nao sobem juntos) ha
 * uma janela em que um navegador com a pagina velha fala com o gateway novo —
 * sem isto, essa janela e chat quebrado. REMOVER quando web e gateway
 * estiverem os dois em producao com o nome novo.
 */
function idDaConversa(payload: unknown): string {
  const p = payload as { conversationId?: unknown; channelId?: unknown };
  if (typeof p?.conversationId === "string") return p.conversationId;
  if (typeof p?.channelId === "string") return p.channelId;
  return "";
}

export function registerMessageHandlers(
  io: AetherServer,
  socket: AetherSocket,
): void {
  const { userId } = socket.data;

  socket.on("message:send", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;

    if (!payload || typeof payload !== "object") {
      respond({ ok: false, error: "payload invalido" });
      return;
    }

    /**
     * Silenciamento ANTES do rate limit, como sempre foi: quem esta silenciado
     * nao gasta balde. `enviarMensagem` recheca (para a REST e o webhook, que
     * nao passam por aqui) — a regra continua morando num lugar so.
     */
    if (estaSilenciado(socket.data.user)) {
      respond({
        ok: false,
        error: "Sua conta está silenciada e não pode enviar mensagens.",
      });
      return;
    }

    /**
     * Rate limit fica AQUI, na borda, e nao em `enviarMensagem`: cada entrada
     * tem um limitador proprio (o socket por `userId`, a REST por `bot:<app>`).
     * O balde e da PESSOA, nunca da conexao — reconectar nao zera.
     */
    if (!limiter.take(userId)) {
      respond({ ok: false, error: "Muitas mensagens seguidas. Respire." });
      return;
    }

    const p = payload as {
      content?: unknown;
      anexoIds?: unknown;
      replyToId?: unknown;
      nonce?: unknown;
    };

    const resultado = await enviarMensagem(io, {
      /**
       * `socket.data.user` congela no handshake — ok para silenciamento, que
       * revoga a sessao e derruba o socket (`/internal/desconectar-usuario`).
       */
      ator: {
        id: userId,
        silenciadoEm: socket.data.user.silenciadoEm,
        silenciadoAte: socket.data.user.silenciadoAte,
      },
      conversationId: idDaConversa(payload),
      content: p.content,
      anexoIds: p.anexoIds,
      replyToId: p.replyToId,
      nonce: typeof p.nonce === "string" ? p.nonce : null,
      origem: "gateway",
    });

    respond(resultado);
  });

  socket.on("message:history", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;

    if (!payload || typeof payload !== "object") {
      respond({ ok: false, error: "payload invalido" });
      return;
    }
    const { before, after } = payload;
    const conversationId = idDaConversa(payload);

    try {
      const conversa = await autorizarConversa(
        userId,
        conversationId,
        "VIEW_CHANNEL",
      );
      if (!conversa) {
        respond({ ok: false, error: "Conversa nao encontrada" });
        return;
      }

      // `after` busca o intervalo perdido numa queda de conexao: ordem
      // crescente, do mais antigo que falta para frente. `before` pagina para
      // tras ao rolar, entao vem em ordem decrescente e e invertido no fim.
      const paginatingForward = typeof after === "string" && after.length > 0;
      const cursor = paginatingForward ? after : before;

      const rows = await prisma.message.findMany({
        where: {
          ...(conversa.tipo === "canal"
            ? { channelId: conversa.channelId }
            : { dmChannelId: conversa.dmId }),
          // Soft delete: mensagem apagada nao volta pelo historico.
          deletedAt: null,
        },
        select: MESSAGE_SELECT,
        orderBy: { createdAt: paginatingForward ? "asc" : "desc" },
        take: MESSAGE_PAGE_SIZE + 1,
        ...(typeof cursor === "string" && cursor.length > 0
          ? { cursor: { id: cursor }, skip: 1 }
          : {}),
      });

      const hasMore = rows.length > MESSAGE_PAGE_SIZE;
      const page = hasMore ? rows.slice(0, MESSAGE_PAGE_SIZE) : rows;
      const messages = page.map((row) =>
        toPublicMessage(row, userId, BASE_DE_ARQUIVOS),
      );

      respond({
        ok: true,
        // O cliente sempre recebe do mais antigo para o mais novo.
        messages: paginatingForward ? messages : messages.reverse(),
        hasMore,
      });
    } catch (error) {
      log.error("gateway.message.history", "message:history falhou", {
        err: error,
        userId,
        socketId: socket.id,
      });
      respond({ ok: false, error: "Falha ao carregar historico" });
    }
  });

  /**
   * Mesmo limitador de `message:send` — de proposito. E a mesma pessoa gastando
   * do mesmo balde de "acoes de escrita no chat"; um balde separado so para
   * apagar deixaria alguem alternar enviar/apagar para dobrar a rajada real.
   */
  socket.on("message:delete", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;

    if (!payload || typeof payload !== "object") {
      respond({ ok: false, error: "payload invalido" });
      return;
    }
    const { messageId } = payload as { messageId?: unknown };
    if (typeof messageId !== "string" || messageId.length === 0) {
      respond({ ok: false, error: "payload invalido" });
      return;
    }

    if (!limiter.take(userId)) {
      respond({ ok: false, error: "Muitas acoes seguidas. Respire." });
      return;
    }

    try {
      const resultado = await apagarMensagem(io, { atorId: userId, messageId });
      respond(resultado);
    } catch (error) {
      log.error("gateway.message.delete", "message:delete falhou", {
        err: error,
        userId,
        socketId: socket.id,
      });
      respond({ ok: false, error: "Falha ao apagar" });
    }
  });

  /** Mesmo balde do envio e do apagar: e a mesma pessoa escrevendo no chat. */
  socket.on("message:edit", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;

    if (!payload || typeof payload !== "object") {
      respond({ ok: false, error: "payload invalido" });
      return;
    }

    if (!limiter.take(userId)) {
      respond({ ok: false, error: "Muitas acoes seguidas. Respire." });
      return;
    }

    const p = payload as { messageId?: unknown; content?: unknown };
    try {
      const resultado = await editarMensagem(io, {
        ator: {
          id: userId,
          silenciadoEm: socket.data.user.silenciadoEm,
          silenciadoAte: socket.data.user.silenciadoAte,
        },
        messageId: p.messageId,
        content: p.content,
      });
      respond(resultado);
    } catch (error) {
      log.error("gateway.message.edit", "message:edit falhou", {
        err: error,
        userId,
        socketId: socket.id,
      });
      respond({ ok: false, error: "Falha ao editar", codigo: "falha" });
    }
  });

  /**
   * Nao ha `forget` no disconnect de proposito: o balde e da PESSOA, nao da
   * conexao — limpar aqui faria de reconectar um jeito de zerar o limite.
   */
}
