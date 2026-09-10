import { prisma } from "@aether/db";
import {
  estaSilenciado,
  getChannelPermissions,
  loadDmAccess,
  loadMemberAccess,
} from "@aether/access";
import {
  has,
  messageContentSchema,
  room,
  toPublicMessage,
  SELECT_USUARIO_PUBLICO,
  type PermissionKey,
  type PublicMessage,
  type SendMessageAck,
} from "@aether/shared";
import { log } from "@aether/shared/log";
import type { AetherServer } from "./types";
import { publicarMensagemCriada } from "./domain-events";

/**
 * O UNICO caminho de escrita de mensagem.
 *
 * Antes esta logica morava dentro do handler `message:send`. Foi extraida para
 * que a REST v1 de bots (Etapa 6) e o webhook de entrada (Etapa 11) publiquem
 * mensagem passando pela MESMA porta — silenciamento, autorizacao, validacao,
 * transacao, evento — em vez de reimplementar a regra e divergir. O handler do
 * gateway virou uma casca: parseia o payload, aplica o rate limit e delega.
 *
 * NAO e server action no app web pelo mesmo motivo de sempre: dois caminhos de
 * escrita sao dois lugares onde a permissao pode divergir. Continua tudo aqui,
 * no gateway; quem esta fora (a REST no Vercel) chega por `/internal`.
 */

/** De onde os anexos sao servidos — lido uma vez, aqui. */
export const BASE_DE_ARQUIVOS = (process.env.R2_PUBLIC_URL ?? "").replace(
  /\/+$/,
  "",
);

/** Quantos arquivos por mensagem. O mesmo teto vale na tela. */
export const MAX_ANEXOS = 10;

/** Anexo que nao e seu, nao chegou, ou ja foi usado em outra mensagem. */
class AnexosInvalidos extends Error {
  override name = "AnexosInvalidos";
}

/** Campos que viram `PublicMessage` — os mesmos no gateway e no app web. */
export const MESSAGE_SELECT = {
  id: true,
  channelId: true,
  dmChannelId: true,
  reactions: { select: { emoji: true, userId: true } },
  anexos: {
    select: {
      id: true,
      nome: true,
      mime: true,
      tamanho: true,
      chave: true,
      largura: true,
      altura: true,
    },
  },
  content: true,
  createdAt: true,
  editedAt: true,
  author: {
    select: SELECT_USUARIO_PUBLICO,
  },
  replyTo: {
    select: {
      id: true,
      content: true,
      deletedAt: true,
      author: { select: { displayName: true } },
    },
  },
} as const;

/**
 * Onde uma mensagem vive. Uniao discriminada porque as duas metades nao tem
 * quase nada em comum: uma tem servidor, cargo e overwrite; a outra tem duas
 * pessoas e uma amizade.
 */
export type Conversa =
  | { tipo: "canal"; channelId: string; serverId: string; isText: boolean }
  | { tipo: "dm"; dmId: string; outroId: string };

/**
 * Resolve a conversa e confere se quem pediu pode fazer o que quer nela.
 *
 * Devolve `null` para QUALQUER recusa — id inexistente, nao ser membro, nao
 * ser participante, permissao negada. Todas respondem igual para nao vazar o
 * que existe.
 *
 * O FORK ACONTECE AQUI, e so aqui. As duas regras continuam morando em
 * `@aether/access` — esta funcao escolhe qual perguntar, nao reimplementa
 * nenhuma. `permission` so vale para canal de servidor: numa conversa direta
 * nao existe bit a conferir, a amizade E a permissao.
 */
export async function autorizarConversa(
  userId: string,
  conversationId: string,
  permission: PermissionKey,
): Promise<Conversa | null> {
  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return null;
  }

  const channel = await prisma.channel.findUnique({
    where: { id: conversationId },
    select: { serverId: true, type: true },
  });

  /**
   * Nao achou canal: pode ser uma conversa direta. Ids sao cuid e nao se
   * cruzam, entao nao ha ambiguidade — no maximo uma das duas buscas acerta.
   */
  if (!channel) {
    const dm = await loadDmAccess(userId, conversationId);
    if (!dm) return null;
    return { tipo: "dm", dmId: dm.dmId, outroId: dm.outroId };
  }

  const access = await loadMemberAccess(channel.serverId, userId);
  if (!access) return null;

  const bits = await getChannelPermissions(access, conversationId);
  if (bits === null || !has(bits, permission)) return null;

  return {
    tipo: "canal",
    channelId: conversationId,
    serverId: channel.serverId,
    isText: channel.type === "TEXT",
  };
}

/** O ator, e o minimo que a regra de envio precisa saber sobre ele. */
export interface AtorDeMensagem {
  id: string;
  silenciadoEm: Date | null;
  silenciadoAte: Date | null;
}

export interface EntradaDeMensagem {
  ator: AtorDeMensagem;
  conversationId: string;
  /** validado aqui dentro — pode vir de qualquer coisa */
  content: unknown;
  anexoIds?: unknown;
  replyToId?: unknown;
  /** devolvido no evento para o cliente reconciliar a mensagem otimista */
  nonce?: string | null;
  /** so para log — nao muda regra nenhuma */
  origem: "gateway" | "api" | "webhook";
}

/**
 * `SendMessageAck` do `@aether/shared` — o mesmo contrato do socket. Cada
 * recusa aqui SEMPRE traz `codigo` (a REST mapeia para HTTP); as recusas de
 * borda do handler nao precisam.
 */
export type ResultadoDeEnvio = SendMessageAck;

/**
 * Cria a mensagem e emite `message:new`. `io` entra por parametro porque a
 * emissao precisa dele; a REST de bots vai chamar isto pelo mesmo `io` do
 * processo do gateway.
 *
 * A ordem e a MESMA do handler antigo, passo a passo — silenciamento, conteudo,
 * autorizacao, canal-de-voz, resposta, transacao, evento — para o chat humano
 * nao mudar de comportamento.
 */
export async function enviarMensagem(
  io: AetherServer,
  entrada: EntradaDeMensagem,
): Promise<ResultadoDeEnvio> {
  const { ator, conversationId, nonce = null, origem } = entrada;

  /**
   * Silenciamento GLOBAL. O gateway passa o estado congelado do handshake (ok,
   * porque silenciar revoga a sessao e derruba o socket); a REST vai passar
   * uma leitura fresca.
   */
  if (estaSilenciado(ator)) {
    return {
      ok: false,
      error: "Sua conta está silenciada e não pode enviar mensagens.",
      codigo: "silenciado",
    };
  }

  const anexoIds = Array.isArray(entrada.anexoIds)
    ? entrada.anexoIds
        .filter((id): id is string => typeof id === "string" && id.length > 0)
        .slice(0, MAX_ANEXOS)
    : [];

  const replyToId =
    typeof entrada.replyToId === "string" && entrada.replyToId.length > 0
      ? entrada.replyToId
      : null;

  /**
   * COM ANEXO, o texto pode ser vazio — mandar so uma imagem e o caso comum.
   * Sem anexo, continua valendo a validacao de sempre: mensagem vazia nao
   * existe.
   */
  const conteudoBruto =
    typeof entrada.content === "string" ? entrada.content : "";
  const parsed =
    anexoIds.length > 0 && conteudoBruto.trim().length === 0
      ? ({ success: true, data: "" } as const)
      : messageContentSchema.safeParse(entrada.content);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Mensagem invalida",
      codigo: "invalida",
    };
  }

  try {
    const conversa = await autorizarConversa(
      ator.id,
      conversationId,
      "SEND_MESSAGES",
    );
    if (!conversa) {
      return {
        ok: false,
        error: "Conversa nao encontrada",
        codigo: "nao_encontrada",
      };
    }
    if (conversa.tipo === "canal" && !conversa.isText) {
      return {
        ok: false,
        error: "Canal de voz nao aceita mensagem",
        codigo: "canal_de_voz",
      };
    }

    /**
     * A mensagem respondida tem que ser DESTA conversa e existir. Id de outra
     * conversa vazaria conteudo de onde a pessoa nao entra; id apagado ou
     * inventado nao quebra — a resposta so sai sem referencia.
     */
    let replyValido: string | null = null;
    if (replyToId) {
      const alvo = await prisma.message.findFirst({
        where: {
          id: replyToId,
          deletedAt: null,
          ...(conversa.tipo === "canal"
            ? { channelId: conversa.channelId }
            : { dmChannelId: conversa.dmId }),
        },
        select: { id: true },
      });
      replyValido = alvo?.id ?? null;
    }

    /**
     * A mensagem e os anexos entram JUNTOS, numa transacao. Sem ela, uma falha
     * ao ligar os anexos deixaria a mensagem publicada sem os arquivos.
     */
    const created = await prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: {
          authorId: ator.id,
          content: parsed.data,
          ...(replyValido ? { replyToId: replyValido } : {}),
          ...(conversa.tipo === "canal"
            ? { channelId: conversa.channelId }
            : { dmChannelId: conversa.dmId }),
        },
        select: { id: true },
      });

      if (anexoIds.length > 0) {
        /**
         * AS TRES CONDICOES VAO NO WHERE, e nao numa leitura antes: anexo de
         * outra pessoa nao entra; `prontoEm` nao nulo (o objeto chegou ao R2);
         * `messageId` nulo (cada anexo vale UMA vez). O banco avalia isso sob
         * trava de linha.
         */
        const { count } = await tx.attachment.updateMany({
          where: {
            id: { in: anexoIds },
            userId: ator.id,
            prontoEm: { not: null },
            messageId: null,
          },
          data: { messageId: msg.id },
        });

        if (count !== anexoIds.length) {
          throw new AnexosInvalidos();
        }
      }

      return tx.message.findUniqueOrThrow({
        where: { id: msg.id },
        select: MESSAGE_SELECT,
      });
    });

    const message: PublicMessage = toPublicMessage(
      created,
      ator.id,
      BASE_DE_ARQUIVOS,
    );

    if (conversa.tipo === "canal") {
      io.to(room.channel(conversa.channelId)).emit("message:new", {
        message,
        nonce,
        serverId: conversa.serverId,
      });
      // E o mesmo fato como evento publico para os bots do canal (Etapa 10).
      publicarMensagemCriada(io, message, conversa.serverId);
    } else {
      io.to([room.user(ator.id), room.user(conversa.outroId)]).emit(
        "message:new",
        { message, nonce, serverId: null },
      );
    }

    return { ok: true, message };
  } catch (error) {
    if (error instanceof AnexosInvalidos) {
      return {
        ok: false,
        error: "Algum arquivo nao esta mais disponivel. Anexe de novo.",
        codigo: "anexos",
      };
    }
    log.error("gateway.enviar_mensagem.falhou", "enviarMensagem falhou", {
      err: error,
      atorId: ator.id,
      origem,
    });
    return { ok: false, error: "Falha ao enviar", codigo: "falha" };
  }
}
