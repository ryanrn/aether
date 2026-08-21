import { prisma } from "@aether/db";
import { getChannelPermissions, loadMemberAccess } from "@aether/access";
import {
  has,
  messageContentSchema,
  room,
  toPublicMessage,
  MESSAGE_PAGE_SIZE,
  type PermissionKey,
  type PublicMessage,
} from "@aether/shared";
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
const MESSAGE_SELECT = {
  id: true,
  channelId: true,
  content: true,
  createdAt: true,
  editedAt: true,
  author: {
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      status: true,
    },
  },
} as const;

/**
 * Resolve o canal e confere a permissao pedida nele.
 * Devolve `null` para qualquer recusa: canal inexistente, usuario que nao e
 * membro e permissao negada respondem igual, para nao vazar o que existe.
 */
async function authorizeChannel(
  userId: string,
  channelId: string,
  permission: PermissionKey,
): Promise<{ serverId: string; isText: boolean } | null> {
  if (typeof channelId !== "string" || channelId.length === 0) return null;

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { serverId: true, type: true },
  });
  if (!channel) return null;

  const access = await loadMemberAccess(channel.serverId, userId);
  if (!access) return null;

  const bits = await getChannelPermissions(access, channelId);
  if (bits === null || !has(bits, permission)) return null;

  return { serverId: channel.serverId, isText: channel.type === "TEXT" };
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
    const { channelId, content, nonce } = payload;

    if (!limiter.take(socket.id)) {
      respond({ ok: false, error: "Muitas mensagens seguidas. Respire." });
      return;
    }

    const parsed = messageContentSchema.safeParse(content);
    if (!parsed.success) {
      respond({
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Mensagem invalida",
      });
      return;
    }

    try {
      const channel = await authorizeChannel(
        userId,
        channelId,
        "SEND_MESSAGES",
      );
      if (!channel) {
        respond({ ok: false, error: "Canal nao encontrado" });
        return;
      }
      if (!channel.isText) {
        respond({ ok: false, error: "Canal de voz nao aceita mensagem" });
        return;
      }

      const created = await prisma.message.create({
        data: { channelId, authorId: userId, content: parsed.data },
        select: MESSAGE_SELECT,
      });
      const message: PublicMessage = toPublicMessage(created);

      // Vai para a sala inteira, inclusive para quem enviou: o remetente pode
      // ter outra aba aberta, e ela precisa da mensagem tambem.
      io.to(room.channel(channelId)).emit("message:new", {
        message,
        nonce: typeof nonce === "string" ? nonce : null,
      });

      respond({ ok: true, message });
    } catch (error) {
      console.error("[gateway] message:send falhou:", error);
      respond({ ok: false, error: "Falha ao enviar" });
    }
  });

  socket.on("message:history", async (payload, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;

    if (!payload || typeof payload !== "object") {
      respond({ ok: false, error: "payload invalido" });
      return;
    }
    const { channelId, before, after } = payload;

    try {
      const channel = await authorizeChannel(userId, channelId, "VIEW_CHANNEL");
      if (!channel) {
        respond({ ok: false, error: "Canal nao encontrado" });
        return;
      }

      // `after` busca o intervalo perdido numa queda de conexao: ordem
      // crescente, do mais antigo que falta para frente. `before` pagina para
      // tras ao rolar, entao vem em ordem decrescente e e invertido no fim.
      const paginatingForward = typeof after === "string" && after.length > 0;
      const cursor = paginatingForward ? after : before;

      const rows = await prisma.message.findMany({
        where: {
          channelId,
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
      const messages = page.map(toPublicMessage);

      respond({
        ok: true,
        // O cliente sempre recebe do mais antigo para o mais novo.
        messages: paginatingForward ? messages : messages.reverse(),
        hasMore,
      });
    } catch (error) {
      console.error("[gateway] message:history falhou:", error);
      respond({ ok: false, error: "Falha ao carregar historico" });
    }
  });

  socket.on("disconnect", () => {
    limiter.forget(socket.id);
  });
}
