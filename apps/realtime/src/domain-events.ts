import type { EventMessageCreate, PublicMessage } from "@aether/shared";
import type { AetherServer } from "./types";
import { dispatchParaBots } from "./bot-gateway";

/**
 * Ponto unico onde um fato do AETHER vira evento publico para os bots.
 *
 * Hoje so `MESSAGE_CREATE`. Fica separado do `enviarMensagem` (que ja emite o
 * `message:new` humano) para a lista de eventos crescer sem inchar aquele
 * arquivo, e para o mapa "interno -> publico" morar num lugar so.
 */

/**
 * Uma mensagem entrou num CANAL DE SERVIDOR. Traduz o `PublicMessage` para o
 * formato enxuto que o bot recebe e entrega aos que estao na sala do canal.
 *
 * DM nao passa por aqui — `serverId` e obrigatorio, e o bot nao participa de
 * conversa direta.
 */
export function publicarMensagemCriada(
  io: AetherServer,
  message: PublicMessage,
  serverId: string,
): void {
  const evento: EventMessageCreate = {
    id: message.id,
    channelId: message.conversationId,
    serverId,
    content: message.content,
    author: {
      id: message.author.id,
      username: message.author.username,
      displayName: message.author.displayName,
      avatarUrl: message.author.avatarUrl,
      bot: message.author.kind !== "HUMAN",
    },
    createdAt: message.createdAt,
    replyToId: message.replyTo?.id ?? null,
  };

  dispatchParaBots(io, message.conversationId, {
    t: "MESSAGE_CREATE",
    d: evento,
  });
}
