import { prisma } from "@aether/db";
import { estaSilenciado } from "@aether/access";
import {
  messageContentSchema,
  room,
  type EditMessageAck,
} from "@aether/shared";
import type { AetherServer } from "./types";
import { autorizarConversa, type AtorDeMensagem } from "./enviar-mensagem";

/**
 * Edita o texto de uma mensagem — o terceiro caminho de escrita, ao lado de
 * `enviarMensagem` e `apagarMensagem`.
 *
 * So o AUTOR edita, sem excecao para moderador: editar e por palavras na boca
 * de alguem. Moderador que discorda apaga (`apagarMensagem`).
 *
 * Alem de ser o autor, a pessoa precisa AINDA poder escrever na conversa
 * (`autorizarConversa` com `SEND_MESSAGES`, a mesma porta do envio). Quem foi
 * expulso, perdeu o cargo ou deixou de ser amigo nao reescreve o que ficou
 * para tras — do contrario editar viraria um jeito de continuar falando num
 * lugar de onde a pessoa saiu.
 *
 * `editedAt` existia no schema desde a fase 3 e nunca era gravado; nao ha
 * migracao.
 */

export interface EntradaDeEdicao {
  ator: AtorDeMensagem;
  messageId: unknown;
  content: unknown;
}

const NAO_ENCONTRADA: EditMessageAck = {
  ok: false,
  error: "Mensagem nao encontrada",
  codigo: "nao_encontrada",
};

export async function editarMensagem(
  io: AetherServer,
  entrada: EntradaDeEdicao,
): Promise<EditMessageAck> {
  const { ator, messageId } = entrada;

  if (estaSilenciado(ator)) {
    return {
      ok: false,
      error: "Sua conta está silenciada e não pode editar mensagens.",
      codigo: "silenciado",
    };
  }

  if (typeof messageId !== "string" || messageId.length === 0) {
    return NAO_ENCONTRADA;
  }

  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      authorId: true,
      channelId: true,
      dmChannelId: true,
      content: true,
      editedAt: true,
      deletedAt: true,
      _count: { select: { anexos: true } },
    },
  });

  /**
   * "Nao existe", "ja apagada" e "nao e sua" respondem IGUAL. Diferenciar
   * ensinaria a quem chuta ids quais acertaram uma mensagem real.
   */
  if (!msg || msg.deletedAt !== null || msg.authorId !== ator.id) {
    return NAO_ENCONTRADA;
  }

  const conversationId = msg.channelId ?? msg.dmChannelId;
  if (!conversationId) return NAO_ENCONTRADA;

  /**
   * Mesma regra do envio: com anexo, o texto pode ficar vazio (a mensagem
   * continua sendo a imagem). Sem anexo, mensagem vazia nao existe — quem
   * quer apagar tudo usa apagar.
   */
  const bruto = typeof entrada.content === "string" ? entrada.content : "";
  const parsed =
    msg._count.anexos > 0 && bruto.trim().length === 0
      ? ({ success: true, data: "" } as const)
      : messageContentSchema.safeParse(entrada.content);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Mensagem invalida",
      codigo: "invalida",
    };
  }

  const conversa = await autorizarConversa(
    ator.id,
    conversationId,
    "SEND_MESSAGES",
  );
  if (!conversa) return NAO_ENCONTRADA;

  // Nada mudou: nao carimba "(editada)" por um Enter sem alteracao.
  if (parsed.data === msg.content) {
    return {
      ok: true,
      content: msg.content,
      editedAt: msg.editedAt ? msg.editedAt.toISOString() : null,
    };
  }

  /**
   * `updateMany` com `deletedAt: null` no WHERE: se a mensagem for apagada
   * entre a leitura acima e esta escrita, a edicao nao ressuscita o texto.
   */
  const editedAt = new Date();
  const { count } = await prisma.message.updateMany({
    where: { id: messageId, authorId: ator.id, deletedAt: null },
    data: { content: parsed.data, editedAt },
  });
  if (count === 0) return NAO_ENCONTRADA;

  const evento = {
    messageId,
    conversationId,
    content: parsed.data,
    editedAt: editedAt.toISOString(),
  };
  if (conversa.tipo === "canal") {
    io.to(room.channel(conversa.channelId)).emit("message:updated", evento);
  } else {
    io.to([room.user(ator.id), room.user(conversa.outroId)]).emit(
      "message:updated",
      evento,
    );
  }

  return { ok: true, content: parsed.data, editedAt: evento.editedAt };
}
