import { prisma } from "@aether/db";
import { loadMemberAccess } from "@aether/access";
import {
  GAME_NAME_MAX,
  isUserStatus,
  room,
  safeGameIcon,
  type UserStatus,
} from "@aether/shared";
import type { AetherServer, AetherSocket } from "../types";
import { visibleChannelRooms } from "../rooms";
import {
  detachSocket,
  joinServer,
  leaveServer,
  presenceEntryOf,
  presenceOf,
  setGame,
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
  /**
   * O jogo vem do estado, e nao do parametro: quem chama aqui so tem opiniao
   * sobre o STATUS. Sem isto, todo anuncio de presenca apagaria da tela dos
   * outros o jogo de quem esta jogando — bastaria mudar para "Ausente".
   *
   * No `disconnect` a entrada ja saiu do mapa, e ai o `null` esta certo: quem
   * desconectou nao esta mais jogando aos olhos de ninguem.
   */
  const atual = presenceEntryOf(userId);
  io.to(room.server(serverId)).emit("presence:update", {
    serverId,
    entry: {
      userId,
      status,
      game: atual?.game ?? null,
      gameSince: atual?.gameSince ?? null,
      gameIcon: atual?.gameIcon ?? null,
    },
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

  /**
   * "estou jogando X". Vem do app de desktop, que ja fez o casamento na
   * maquina de quem joga — aqui chega so o nome.
   *
   * O nome e tratado como TEXTO DE CLIENTE, nao como verdade: cortado no
   * tamanho maximo e podado nas pontas. Nao ha lista de jogos validos para
   * conferir contra, e inventar uma so criaria um cadastro para manter — o
   * dano possivel de um nome mentiroso e alguem dizer que joga o que nao joga.
   *
   * Nao persiste em lugar nenhum: jogo aberto e coisa do momento, como a
   * propria presenca. Reiniciar o gateway limpa, e esta anotado no README.
   */
  socket.on("presence:game", (payload) => {
    const bruto = payload?.name;
    const nome =
      typeof bruto === "string" && bruto.trim().length > 0
        ? bruto.trim().slice(0, GAME_NAME_MAX)
        : null;

    /**
     * O icone e renderizado na tela dos OUTROS, entao nada de confiar no que
     * chegou: `safeGameIcon` so aceita data URL de imagem raster, com teto de
     * tamanho, e recusa SVG de proposito — SVG e documento, aceita script.
     * Icone invalido vira `null` e a pessoa aparece so com o nome.
     */
    const icone = nome ? safeGameIcon(payload?.icon) : null;

    const mudou = setGame(userId, nome, icone);
    if (!mudou) return;

    for (const serverId of mudou.servers) {
      io.to(room.server(serverId)).emit("presence:update", {
        serverId,
        entry: mudou.entry,
      });
    }
  });

  socket.on("disconnect", () => {
    const { vacatedServers } = detachSocket(socket.id);
    for (const serverId of vacatedServers) {
      announce(io, serverId, userId, "OFFLINE");
    }
  });
}
