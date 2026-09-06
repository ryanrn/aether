import { Prisma, prisma } from "@aether/db";
import { emojiSchema, room, type PublicReaction } from "@aether/shared";
import { log } from "@aether/shared/log";
import type { AetherServer, AetherSocket } from "../types";
import { createRateLimiter } from "../rate-limit";
import { autorizarConversa } from "./messages";

/**
 * Reacoes de emoji nas mensagens.
 *
 * A AUTORIZACAO E A DA MENSAGEM, e nao uma regra nova: quem pode VER o canal
 * pode reagir. Isso e deliberado — reagir e mais leve que escrever, e exigir
 * `SEND_MESSAGES` faria de um canal de anuncios um lugar onde ninguem pode nem
 * dizer "👍". Quem nao enxerga o canal nao chega aqui: `autorizarConversa`
 * devolve `null` e a acao para.
 */

/**
 * Reagir grava no banco, entao precisa de limite.
 *
 * Mais folgado que o de mensagem (8 a 2/s) porque clicar em varios emojis
 * seguidos e uso normal — a pessoa reage a tres mensagens de uma vez ao voltar
 * de uma conversa. 15 de rajada cobre isso; 3/s em regime corta laco.
 */
const limiter = createRateLimiter({ capacity: 15, refillPerSecond: 3 });

/**
 * Todas as reacoes de uma mensagem, agrupadas do ponto de vista de UMA pessoa.
 *
 * Refeita do banco depois de cada mudanca, em vez de calculada a partir do que
 * acabou de acontecer. Uma consulta a mais em troca de a contagem nunca
 * derivar do que o processo achava que era o estado — com varias pessoas
 * reagindo ao mesmo tempo, "somar 1 ao que eu tinha" erra.
 */
async function reacoesDaMensagem(
  messageId: string,
  paraUserId: string,
): Promise<PublicReaction[]> {
  const linhas = await prisma.reaction.findMany({
    where: { messageId },
    select: { emoji: true, userId: true },
    // Estavel: o primeiro emoji a aparecer fica na frente, e os botoes nao
    // saltam de lugar quando alguem reage.
    orderBy: { createdAt: "asc" },
  });

  const porEmoji = new Map<string, PublicReaction>();
  for (const linha of linhas) {
    const atual = porEmoji.get(linha.emoji);
    if (atual) {
      atual.count += 1;
      if (linha.userId === paraUserId) atual.mine = true;
    } else {
      porEmoji.set(linha.emoji, {
        emoji: linha.emoji,
        count: 1,
        mine: linha.userId === paraUserId,
      });
    }
  }
  return [...porEmoji.values()];
}

export function registerReactionHandlers(
  io: AetherServer,
  socket: AetherSocket,
): void {
  const { userId } = socket.data;

  socket.on("reaction:toggle", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;

    const messageId = payload?.messageId;
    if (typeof messageId !== "string" || messageId.length === 0) {
      respond({ ok: false, error: "Mensagem invalida" });
      return;
    }

    const emoji = emojiSchema.safeParse(payload?.emoji);
    if (!emoji.success) {
      respond({
        ok: false,
        error: emoji.error.issues[0]?.message ?? "Emoji invalido",
      });
      return;
    }

    if (!limiter.take(userId)) {
      respond({ ok: false, error: "Devagar com as reacoes." });
      return;
    }

    try {
      const mensagem = await prisma.message.findUnique({
        where: { id: messageId },
        select: { id: true, channelId: true, dmChannelId: true, deletedAt: true },
      });
      // Apagada responde igual a inexistente: nao ha o que reagir nos dois casos.
      if (!mensagem || mensagem.deletedAt) {
        respond({ ok: false, error: "Mensagem nao encontrada" });
        return;
      }

      /**
       * A permissao vem da CONVERSA da mensagem, pela mesma funcao que o envio
       * e o historico usam. `VIEW_CHANNEL` e o suficiente: ver e poder reagir.
       */
      const conversa = await autorizarConversa(
        userId,
        mensagem.channelId ?? mensagem.dmChannelId ?? "",
        "VIEW_CHANNEL",
      );
      if (!conversa) {
        respond({ ok: false, error: "Mensagem nao encontrada" });
        return;
      }

      /**
       * ALTERNAR pelo indice unico, e nao por "conferir e decidir".
       *
       * Tentar criar e tratar a colisao torna a operacao correta sob dois
       * cliques simultaneos: um cria, o outro colide e remove. Uma checagem
       * antes ("ja existe?") perderia essa corrida e deixaria a pessoa com a
       * reacao ligada quando ela quis desligar — ou pior, com linha duplicada
       * se o indice nao existisse.
       */
      try {
        await prisma.reaction.create({
          data: { messageId, userId, emoji: emoji.data },
        });
      } catch (erro) {
        const jaExistia =
          erro instanceof Prisma.PrismaClientKnownRequestError &&
          erro.code === "P2002";
        if (!jaExistia) throw erro;
        await prisma.reaction.deleteMany({
          where: { messageId, userId, emoji: emoji.data },
        });
      }

      await emitirReacoes(io, messageId, userId, conversa);
      respond({ ok: true });
    } catch (error) {
      log.error("gateway.reaction.toggle", "reaction:toggle falhou", {
        err: error,
        userId,
        socketId: socket.id,
      });
      respond({ ok: false, error: "Falha ao reagir" });
    }
  });
}

/**
 * Manda a lista nova para quem precisa ver.
 *
 * PERSONALIZADO POR PESSOA, e e por isso que isto nao e um `io.to(sala).emit`
 * simples: `mine` depende de quem esta recebendo. Mandar a mesma carga para a
 * sala inteira acenderia o botao de todo mundo quando UMA pessoa reagisse.
 *
 * O custo e uma consulta por destinatario DISTINTO. Na escala deste projeto —
 * um punhado de gente por canal — isso e barato; num canal com centenas seria
 * melhor mandar a lista sem `mine` e deixar o cliente cruzar com o proprio id.
 */
async function emitirReacoes(
  io: AetherServer,
  messageId: string,
  quemAgiu: string,
  conversa:
    | { tipo: "canal"; channelId: string; serverId: string; isText: boolean }
    | { tipo: "dm"; dmId: string; outroId: string },
): Promise<void> {
  /**
   * As mesmas salas por onde a MENSAGEM viaja — canal, ou as duas pessoais da
   * conversa direta. Usar outro caminho aqui criaria a chance de a reacao
   * chegar a quem a mensagem nao chegou.
   */
  const salas =
    conversa.tipo === "canal"
      ? [room.channel(conversa.channelId)]
      : [room.user(quemAgiu), room.user(conversa.outroId)];

  const sockets = await io.in(salas).fetchSockets();

  // Uma consulta por PESSOA, e nao por socket: quem tem tres abas abertas
  // recebe a mesma lista nas tres.
  const cache = new Map<string, PublicReaction[]>();
  for (const alvo of sockets) {
    const destinatario = alvo.data.userId;
    if (!cache.has(destinatario)) {
      cache.set(destinatario, await reacoesDaMensagem(messageId, destinatario));
    }
    alvo.emit("reaction:update", {
      messageId,
      reactions: cache.get(destinatario) ?? [],
    });
  }
}
