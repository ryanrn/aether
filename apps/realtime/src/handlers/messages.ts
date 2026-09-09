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
  MESSAGE_PAGE_SIZE,
  SELECT_USUARIO_PUBLICO,
  type PermissionKey,
  type PublicMessage,
} from "@aether/shared";
import { log } from "@aether/shared/log";
import type { AetherServer, AetherSocket } from "../types";
import { createRateLimiter } from "../rate-limit";

/**
 * Chat de texto.
 *
 * O gateway e o UNICO caminho de escrita de mensagem. Poderia haver uma server
 * action no app web fazendo o mesmo, e e exatamente por isso que nao ha: dois
 * caminhos para o mesmo dado sao dois lugares onde a regra de permissao pode
 * divergir.
 *
 * Toda mensagem revalida a permissao no banco. Cache de permissao aqui seria o
 * mecanismo pelo qual alguem continua postando num canal do qual ja perdeu
 * acesso.
 */

/** Rajada de 8, reposicao de 2/s: digitar rapido passa, laco automatizado nao. */
const limiter = createRateLimiter({ capacity: 8, refillPerSecond: 2 });

/** Campos que viram PublicMessage — os mesmos no gateway e no app web. */
/**
 * De onde os anexos sao servidos. Lida uma vez, aqui — `toPublicMessage`
 * recebe por parametro porque ela tambem roda no navegador, onde nao ha
 * `process.env`.
 */
const BASE_DE_ARQUIVOS = (process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, "");

/** Quantos arquivos por mensagem. O mesmo teto vale na tela. */
const MAX_ANEXOS = 10;

/** Anexo que nao e seu, nao chegou, ou ja foi usado em outra mensagem. */
class AnexosInvalidos extends Error {
  override name = "AnexosInvalidos";
}

const MESSAGE_SELECT = {
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
type Conversa =
  | { tipo: "canal"; channelId: string; serverId: string; isText: boolean }
  | { tipo: "dm"; dmId: string; outroId: string };

/**
 * Resolve a conversa e confere se quem pediu pode fazer o que quer nela.
 *
 * Devolve `null` para QUALQUER recusa — id inexistente, nao ser membro, nao
 * ser participante, permissao negada. Todas respondem igual para nao vazar o
 * que existe, e no caso da conversa direta isso importa ainda mais: distinguir
 * "nao existe" de "existe e nao e sua" contaria que duas pessoas especificas
 * se falam.
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

/**
 * Le o id da conversa aceitando TAMBEM o nome antigo `channelId`.
 *
 * COMPATIBILIDADE TEMPORARIA, com data para sair. O campo se chamava
 * `channelId` ate as conversas diretas existirem. Vercel e Fly nao sobem no
 * mesmo instante: entre um deploy e o outro ha uma janela em que o navegador
 * de alguem ja carregou a versao velha da pagina e fala com o gateway novo, ou
 * o contrario. Sem isto, essa janela e chat quebrado com "conversa nao
 * encontrada" para todo mundo.
 *
 * REMOVER depois que web e gateway estiverem os dois em producao com o nome
 * novo — esta anotado nas limitacoes do README.
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

    /**
     * Silenciamento GLOBAL. Lido de `socket.data.user`, que congela no
     * handshake — ok, porque silenciar tambem revoga a sessao e derruba o
     * socket (`/internal/desconectar-usuario`), entao um socket que ainda
     * chega aqui e de antes da acao. Cobre canal e DM: os dois passam por
     * `message:send`.
     */
    if (estaSilenciado(socket.data.user)) {
      respond({
        ok: false,
        error: "Sua conta está silenciada e não pode enviar mensagens.",
      });
      return;
    }

    if (!payload || typeof payload !== "object") {
      respond({ ok: false, error: "payload invalido" });
      return;
    }
    const { content, nonce } = payload;
    const conversationId = idDaConversa(payload);
    /**
     * Os anexos chegam como IDS, e nao como nome/tamanho/url.
     *
     * O que o cliente manda aqui e so um ponteiro para uma linha que o app web
     * ja criou depois de conferir o plano e a assinatura do R2. Aceitar os
     * dados do arquivo por aqui deixaria qualquer um dizer "meu anexo tem 1 KB
     * e se chama foto.png" apontando para outra coisa — e o teto por plano
     * viraria enfeite.
     */
    const anexoIds = Array.isArray(payload.anexoIds)
      ? payload.anexoIds
          .filter((id): id is string => typeof id === "string" && id.length > 0)
          .slice(0, MAX_ANEXOS)
      : [];

    const replyToId =
      typeof payload.replyToId === "string" && payload.replyToId.length > 0
        ? payload.replyToId
        : null;

    if (!limiter.take(userId)) {
      respond({ ok: false, error: "Muitas mensagens seguidas. Respire." });
      return;
    }

    /**
     * COM ANEXO, o texto pode ser vazio — mandar so uma imagem e o caso comum.
     * Sem anexo, continua valendo a validacao de sempre: mensagem vazia nao
     * existe.
     */
    const conteudoBruto = typeof content === "string" ? content : "";
    const parsed =
      anexoIds.length > 0 && conteudoBruto.trim().length === 0
        ? ({ success: true, data: "" } as const)
        : messageContentSchema.safeParse(content);
    if (!parsed.success) {
      respond({
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Mensagem invalida",
      });
      return;
    }

    try {
      const conversa = await autorizarConversa(
        userId,
        conversationId,
        "SEND_MESSAGES",
      );
      if (!conversa) {
        respond({ ok: false, error: "Conversa nao encontrada" });
        return;
      }
      if (conversa.tipo === "canal" && !conversa.isText) {
        respond({ ok: false, error: "Canal de voz nao aceita mensagem" });
        return;
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
       * A mensagem e os anexos entram JUNTOS, numa transacao.
       *
       * Sem ela, uma falha ao ligar os anexos deixaria a mensagem publicada
       * sem os arquivos — e a pessoa veria o texto sair sozinho, sem entender
       * por que a imagem sumiu.
       */
      const created = await prisma.$transaction(async (tx) => {
        const msg = await tx.message.create({
          data: {
            authorId: userId,
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
           * AS TRES CONDICOES VAO NO WHERE, e nao numa leitura antes.
           *
           *  - `userId`: anexo de outra pessoa nao entra na sua mensagem;
           *  - `prontoEm` nao nulo: o servidor ja confirmou o objeto no R2, e
           *    sem isso a mensagem sairia apontando para o vazio;
           *  - `messageId` nulo: cada anexo vale UMA vez. Sem esta, o mesmo id
           *    poderia ser reenviado em varias mensagens, e uma delas apagada
           *    levaria o arquivo das outras junto.
           *
           * O banco avalia isso sob trava de linha, e por isso duas mensagens
           * simultaneas com o mesmo anexo nao passam as duas — mesmo formato do
           * resgate de convite e de chave.
           */
          const { count } = await tx.attachment.updateMany({
            where: {
              id: { in: anexoIds },
              userId,
              prontoEm: { not: null },
              messageId: null,
            },
            data: { messageId: msg.id },
          });

          /**
           * Faltou algum? A mensagem inteira volta atras.
           *
           * Publicar com menos arquivos do que a pessoa anexou seria pior que
           * recusar: ela veria a mensagem no ar e teria de conferir um por um
           * para notar o que sumiu.
           */
          if (count !== anexoIds.length) {
            throw new AnexosInvalidos();
          }
        }

        return tx.message.findUniqueOrThrow({
          where: { id: msg.id },
          select: MESSAGE_SELECT,
        });
      });
      const message: PublicMessage = toPublicMessage(created, userId, BASE_DE_ARQUIVOS);

      /**
       * Para onde a mensagem vai depende do tipo, e as duas entregas incluem
       * quem enviou: o remetente pode ter outra aba aberta, e ela precisa da
       * mensagem tambem.
       *
       * A conversa direta usa as SALAS PESSOAIS, que ja existem desde a
       * funcionalidade de amigos — todo socket entra na sua ao conectar. Nao
       * ha sala a criar, nem a entrar, nem a limpar quando a amizade acaba: a
       * proxima mensagem simplesmente nao passa mais por `loadDmAccess`.
       */
      if (conversa.tipo === "canal") {
        io.to(room.channel(conversa.channelId)).emit("message:new", {
          message,
          nonce: typeof nonce === "string" ? nonce : null,
          serverId: conversa.serverId,
        });
      } else {
        io.to([room.user(userId), room.user(conversa.outroId)]).emit(
          "message:new",
          {
            message,
            nonce: typeof nonce === "string" ? nonce : null,
            // Conversa direta nao pertence a servidor nenhum.
            serverId: null,
          },
        );
      }

      respond({ ok: true, message });
    } catch (error) {
      if (error instanceof AnexosInvalidos) {
        respond({
          ok: false,
          error: "Algum arquivo nao esta mais disponivel. Anexe de novo.",
        });
        return;
      }
      log.error("gateway.message.send", "message:send falhou", {
        err: error,
        userId,
        socketId: socket.id,
      });
      respond({ ok: false, error: "Falha ao enviar" });
    }
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
          /**
           * Filtrar pela COLUNA do tipo certo, e nao por um id solto: como as
           * duas colunas sao nulaveis, `{ channelId: <id de dm> }` nao daria
           * erro — devolveria zero linhas, e um historico vazio parece
           * "conversa nova" em vez de bug.
           */
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
   * Nao ha `forget` no disconnect de proposito.
   *
   * O balde e da PESSOA, nao da conexao: limpar aqui faria de reconectar um
   * jeito de zerar o limite. O proprio limitador descarta chave cheia e
   * parada, entao a memoria nao cresce sem fim.
   */
}
