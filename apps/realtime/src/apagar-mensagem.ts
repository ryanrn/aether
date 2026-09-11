import { prisma } from "@aether/db";
import { getChannelPermissions, loadMemberAccess } from "@aether/access";
import { has, room, type DeleteMessageAck } from "@aether/shared";
import type { AetherServer } from "./types";

/**
 * Apaga uma mensagem (soft delete) — o segundo caminho de escrita, ao lado de
 * `enviarMensagem`. Fica em arquivo proprio porque a autorizacao e OUTRA: em
 * `enviarMensagem`/`autorizarConversa` quem importa e "quem enxerga o canal";
 * aqui e "o autor da mensagem, ou quem tem MANAGE_MESSAGES nela".
 *
 * `deletedAt` (soft delete) ja existia no schema desde sempre — `resumirResposta`
 * (packages/shared/src/types.ts) ja sabia mostrar "mensagem apagada" numa
 * referencia de resposta. So faltava algo que de fato marcasse a data.
 */

export interface EntradaDeExclusao {
  atorId: string;
  messageId: string;
}

export async function apagarMensagem(
  io: AetherServer,
  entrada: EntradaDeExclusao,
): Promise<DeleteMessageAck> {
  const { atorId, messageId } = entrada;

  if (typeof messageId !== "string" || messageId.length === 0) {
    return {
      ok: false,
      error: "Mensagem nao encontrada",
      codigo: "nao_encontrada",
    };
  }

  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      authorId: true,
      channelId: true,
      dmChannelId: true,
      deletedAt: true,
      channel: { select: { serverId: true } },
    },
  });

  /**
   * "nao existe" e "ja tinha sido apagada" respondem IGUAL — nao ha nada a
   * mais para revelar nos dois casos, e diferenciar so ensinaria quem tenta um
   * id chutado se ele acertou uma mensagem real.
   */
  if (!msg || msg.deletedAt !== null) {
    return {
      ok: false,
      error: "Mensagem nao encontrada",
      codigo: "nao_encontrada",
    };
  }

  const souAutor = msg.authorId === atorId;
  let permitido = souAutor;

  /**
   * So canal de SERVIDOR tem moderador. DM e so entre duas pessoas — nao ha
   * MANAGE_MESSAGES para checar, e nao faria sentido uma delas apagar mensagem
   * da outra.
   */
  if (!permitido && msg.channelId && msg.channel) {
    const acesso = await loadMemberAccess(msg.channel.serverId, atorId);
    if (acesso) {
      const bits = await getChannelPermissions(acesso, msg.channelId);
      permitido = bits !== null && has(bits, "MANAGE_MESSAGES");
    }
  }

  if (!permitido) {
    return {
      ok: false,
      error: "Voce nao pode apagar esta mensagem",
      codigo: "sem_permissao",
    };
  }

  await prisma.message.update({
    where: { id: messageId },
    data: { deletedAt: new Date() },
  });

  if (msg.channelId) {
    io.to(room.channel(msg.channelId)).emit("message:deleted", {
      messageId,
      conversationId: msg.channelId,
    });
  } else if (msg.dmChannelId) {
    const dm = await prisma.dmChannel.findUnique({
      where: { id: msg.dmChannelId },
      select: { userAId: true, userBId: true },
    });
    if (dm) {
      io.to([room.user(dm.userAId), room.user(dm.userBId)]).emit(
        "message:deleted",
        { messageId, conversationId: msg.dmChannelId },
      );
    }
  }

  return { ok: true };
}
