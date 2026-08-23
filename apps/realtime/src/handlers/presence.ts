import { prisma } from "@aether/db";
import { loadMemberAccess } from "@aether/access";
import {
  GAME_NAME_MAX,
  isUserStatus,
  room,
  safeGameCover,
  safeGameIcon,
  type PresenceEntry,
  type UserStatus,
} from "@aether/shared";
import type { AetherServer, AetherSocket } from "../types";
import { visibleChannelRooms } from "../rooms";
import { metadadosDe } from "../games/metadata";
import {
  detachSocket,
  friendsOf,
  isConnected,
  joinServer,
  setGameCover,
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

/**
 * A presenca de alguem no formato que os OUTROS podem ver.
 *
 * Duas coisas acontecem aqui, e as duas importam:
 *
 * 1. O jogo vem do ESTADO, nao do parametro: quem chama so tem opiniao sobre o
 *    status. Sem isto, todo anuncio apagaria da tela dos outros o jogo de quem
 *    esta jogando — bastaria mudar para "Ausente".
 *
 * 2. Invisivel esconde o jogo. `OFFLINE` vindo de alguem conectado quer dizer
 *    INVISIVEL, e aparecer apagado enquanto o nome do jogo continua viajando
 *    pela rede nao e invisibilidade — e invisibilidade so na tela de quem usa
 *    o cliente oficial. Quem escolheu sumir sumiu, e o dado nem sai daqui.
 */
function entryVisivel(userId: string, status: UserStatus): PresenceEntry {
  const atual = presenceEntryOf(userId);
  const invisivel = status === "OFFLINE";
  return {
    userId,
    status,
    game: invisivel ? null : atual?.game ?? null,
    gameSince: invisivel ? null : atual?.gameSince ?? null,
    gameIcon: invisivel ? null : atual?.gameIcon ?? null,
    gameCover: invisivel ? null : atual?.gameCover ?? null,
  };
}

function announce(
  io: AetherServer,
  serverId: string,
  userId: string,
  status: UserStatus,
): void {
  io.to(room.server(serverId)).emit("presence:update", {
    serverId,
    entry: entryVisivel(userId, status),
  });
}

/**
 * Manda a presenca para os amigos, pelas salas pessoais deles.
 *
 * Evento SEPARADO do de servidor, e isso e a decisao de privacidade central
 * desta funcionalidade: `presence:update` carrega `serverId`, e entregar isso
 * a um amigo que nao e membro contaria que aquele servidor existe. Amigo ve a
 * pessoa; nao ve onde ela esta.
 *
 * `friendIds` vem por parametro em vez de ser lido aqui porque no `disconnect`
 * a entrada do usuario ja saiu do mapa — a lista precisa ter sido capturada
 * antes.
 */
function announceToFriends(
  io: AetherServer,
  userId: string,
  status: UserStatus,
  friendIds: string[],
): void {
  if (friendIds.length === 0) return;
  io.to(friendIds.map(room.user)).emit("friend:presence", {
    entry: entryVisivel(userId, status),
  });
}

/**
 * Busca capa e nome oficial e, se vierem, anuncia a presenca de novo.
 *
 * Falha aqui e SEMPRE silenciosa no que diz respeito ao usuario: a atividade
 * ja esta na tela com o que o detector deu. Nao ha nada a desfazer e nada a
 * avisar — so deixamos de melhorar.
 */
async function enriquecer(
  io: AetherServer,
  userId: string,
  jogo: string,
): Promise<void> {
  try {
    const meta = await metadadosDe(jogo);
    /**
     * Validado mesmo vindo de casa. A URL foi montada por nos, mas passa pelo
     * BANCO antes de chegar aqui — e vai para o `src` de uma imagem na tela de
     * outras pessoas. A garantia tem de estar no caminho por onde o dado
     * passa, nao na lembranca de quem escreveu o `urlDaCapa`.
     */
    const capa = safeGameCover(meta.coverUrl);
    const mudou = setGameCover(userId, jogo, capa, meta.displayName);
    if (!mudou) return;

    const visivel = entryVisivel(userId, statusOf(userId));
    for (const serverId of mudou.servers) {
      io.to(room.server(serverId)).emit("presence:update", {
        serverId,
        entry: visivel,
      });
    }
    announceToFriends(io, userId, statusOf(userId), friendsOf(userId));
  } catch (erro) {
    console.error(
      "[presence] nao consegui enriquecer o jogo:",
      erro instanceof Error ? erro.message : "erro desconhecido",
    );
  }
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
    if (!isUserStatus(status)) return;

    const affected = setStatus(userId, status);
    for (const serverId of affected) announce(io, serverId, userId, status);
    // Amigo ve o status mesmo sem servidor em comum — e essa e a unica coisa
    // que ele ve por este caminho.
    announceToFriends(io, userId, status, friendsOf(userId));

    /**
     * OFFLINE aqui e INVISIVEL: a pessoa segue conectada e recebendo tudo, mas
     * aparece apagada para os outros. Antes era recusado — dava para ficar
     * ausente, nunca invisivel.
     *
     * E o unico status que NAO persiste, de proposito. No banco, `OFFLINE`
     * quer dizer "nunca escolheu", e e o que faz `attachSocket` promover para
     * ONLINE ao conectar. Gravar invisivel ali tornaria os dois casos
     * indistinguiveis, e alguem ficaria invisivel para sempre sem entender por
     * que. Invisivel vale para a sessao; a proxima comeca visivel.
     */
    if (status === "OFFLINE") return;

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

    const visivel = entryVisivel(userId, statusOf(userId));
    for (const serverId of mudou.servers) {
      io.to(room.server(serverId)).emit("presence:update", {
        serverId,
        entry: visivel,
      });
    }
    announceToFriends(io, userId, statusOf(userId), friendsOf(userId));

    /**
     * A capa vem DEPOIS, e de proposito.
     *
     * O anuncio acima ja saiu com o nome e o icone do executavel — a atividade
     * aparece na hora. A busca de metadados fala com o banco e, na primeira
     * vez, com o IGDB; pendurar o anuncio nela faria a atividade de todo mundo
     * depender da latencia de um servico de terceiro, e sumir quando ele
     * estivesse fora do ar.
     *
     * Sem `await`: nada aqui pode segurar o handler.
     */
    if (nome) void enriquecer(io, userId, nome);
  });

  socket.on("disconnect", () => {
    /**
     * A lista de amigos e lida ANTES de desmontar: `detachSocket` apaga a
     * entrada do usuario quando cai o ultimo socket dele, e ai nao haveria
     * mais a quem avisar. Foi por isso que `announceToFriends` recebe os ids
     * por parametro em vez de busca-los sozinha.
     */
    const amigos = friendsOf(userId);
    const { vacatedServers } = detachSocket(socket.id);
    for (const serverId of vacatedServers) {
      announce(io, serverId, userId, "OFFLINE");
    }
    /**
     * So avisa os amigos quando o ULTIMO socket caiu. Fechar uma das tres abas
     * nao e ficar offline — e o mesmo criterio que `joinServer`/`leaveServer`
     * ja aplicam por servidor.
     */
    if (!isConnected(userId)) {
      announceToFriends(io, userId, "OFFLINE", amigos);
    }
  });
}
