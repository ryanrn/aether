import { prisma } from "@aether/db";
import { loadMemberAccess } from "@aether/access";
import { isUserStatus, room, type UserStatus } from "@aether/shared";
import type { AetherServer, AetherSocket } from "../types";
import { visibleChannelRooms } from "../rooms";
import {
  detachSocket,
  joinServer,
  leaveServer,
  presenceOf,
  setStatus,
  statusOf,
  voiceOfServer,
} from "../state";

/**
 * Presenca: quem esta online, em quais servidores, com qual status.
 *
 * Regra que atravessa todos os handlers: nada aqui confia no que o cliente
 * manda. O `serverId` chega do cliente, mas quem responde se ele vale e o
 * banco, via loadMemberAccess — o mesmo calculo que o app web usa.
 */

function announce(
  io: AetherServer,
  serverId: string,
  userId: string,
  status: UserStatus,
): void {
  io.to(room.server(serverId)).emit("presence:update", {
    serverId,
    entry: { userId, status },
  });
}

export function registerPresenceHandlers(
  io: AetherServer,
  socket: AetherSocket,
): void {
  const { userId } = socket.data;

  socket.on("server:join", async (serverId, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;

    if (typeof serverId !== "string" || serverId.length === 0) {
      respond({ ok: false, error: "servidor invalido" });
      return;
    }

    try {
      // Revalidado a cada join: cargo pode ter mudado desde o handshake.
      const access = await loadMemberAccess(serverId, userId);
      if (!access) {
        // Mesma politica do app web: nao revelamos que o servidor existe.
        respond({ ok: false, error: "servidor nao encontrado" });
        return;
      }

      await socket.join(room.server(serverId));
      for (const channelRoom of await visibleChannelRooms(access)) {
        await socket.join(channelRoom);
      }

      // Estado de voz vai junto: sem isso, quem abre a pagina veria os canais
      // de voz vazios ate alguem entrar ou sair.
      socket.emit("voice:sync", {
        serverId,
        participants: voiceOfServer(serverId),
      });

      const becamePresent = joinServer(socket.id, serverId);
      // A propria presenca entra na lista antes de responder, senao o cliente
      // se veria offline ate o proximo evento.
      respond({ ok: true, presence: presenceOf(serverId) });

      if (becamePresent) {
        announce(io, serverId, userId, statusOf(userId));
      }
    } catch (error) {
      console.error("[gateway] server:join falhou:", error);
      respond({ ok: false, error: "falha ao entrar no servidor" });
    }
  });

  socket.on("server:leave", async (serverId) => {
    if (typeof serverId !== "string") return;
    const left = leaveServer(socket.id, serverId);
    await socket.leave(room.server(serverId));
    if (left) announce(io, serverId, userId, "OFFLINE");
  });

  socket.on("presence:set", async (status) => {
    if (!isUserStatus(status) || status === "OFFLINE") return;

    const affected = setStatus(userId, status);
    for (const serverId of affected) announce(io, serverId, userId, status);

    // O banco guarda a PREFERENCIA, para o proximo login comecar igual.
    // Escrita so em mudanca deliberada — nao ha volume aqui.
    await prisma.user
      .update({ where: { id: userId }, data: { status } })
      .catch((error) => console.error("[gateway] presence:set nao persistiu:", error));
  });

  socket.on("disconnect", () => {
    const { vacatedServers } = detachSocket(socket.id);
    for (const serverId of vacatedServers) {
      announce(io, serverId, userId, "OFFLINE");
    }
  });
}
