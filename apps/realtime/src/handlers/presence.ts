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
import { log } from "@aether/shared/log";
import type { AetherServer, AetherSocket } from "../types";
import { resyncEavisarServidor, visibleChannelRooms } from "../rooms";
import { createRateLimiter } from "../rate-limit";
import { metadadosDe } from "../games/metadata";
import { sincronizarCargoPorJogo } from "../games/cargos-por-jogo";
import { reavaliarVozDe, vozDosAmigos } from "../voz/voz-de-amigos";
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
import { carenciaOfflineMs, confirmarSaida } from "../carencia-offline";

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
async function entryVisivel(userId: string, status: UserStatus): Promise<PresenceEntry> {
  const atual = await presenceEntryOf(userId);
  const invisivel = status === "OFFLINE";
  return {
    userId,
    status,
    game: invisivel ? null : atual?.game ?? null,
    gameSince: invisivel ? null : atual?.gameSince ?? null,
    gameIcon: invisivel ? null : atual?.gameIcon ?? null,
    gameCover: invisivel ? null : atual?.gameCover ?? null,
    listening: invisivel ? null : atual?.listening ?? null,
  };
}

async function announce(
  io: AetherServer,
  serverId: string,
  userId: string,
  status: UserStatus,
): Promise<void> {
  io.to(room.server(serverId)).emit("presence:update", {
    serverId,
    entry: await entryVisivel(userId, status),
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
async function announceToFriends(
  io: AetherServer,
  userId: string,
  status: UserStatus,
  friendIds: string[],
): Promise<void> {
  if (friendIds.length === 0) return;
  io.to(friendIds.map(room.user)).emit("friend:presence", {
    entry: await entryVisivel(userId, status),
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
    const mudou = await setGameCover(userId, jogo, capa, meta.displayName);
    if (!mudou) return;

    const meuStatus = await statusOf(userId);
    const visivel = await entryVisivel(userId, meuStatus);
    for (const serverId of mudou.servers) {
      io.to(room.server(serverId)).emit("presence:update", {
        serverId,
        entry: visivel,
      });
    }
    await announceToFriends(io, userId, meuStatus, await friendsOf(userId));
  } catch (erro) {
    log.warn("gateway.presence.enriquecer_jogo", "não enriqueci o jogo", {
      err: erro,
      userId,
    });
  }
}

/**
 * Reanuncia a presenca de alguem depois de uma mudanca que veio de FORA de um
 * evento de socket — hoje: o poller do Spotify. Mesmo caminho do `enriquecer`
 * do jogo (servidores + amigos), so que a mudanca ja aconteceu no estado.
 */
export async function anunciarMudancaDePresenca(
  io: AetherServer,
  userId: string,
  servers: string[],
): Promise<void> {
  const meuStatus = await statusOf(userId);
  const visivel = await entryVisivel(userId, meuStatus);
  for (const serverId of servers) {
    io.to(room.server(serverId)).emit("presence:update", {
      serverId,
      entry: visivel,
    });
  }
  await announceToFriends(io, userId, meuStatus, await friendsOf(userId));
}

/**
 * Cargo automatico por jogo (fase 2, estagio 2): poe/tira o cargo de quem esta
 * jogando, um servidor de cada vez, e re-sincroniza as salas SO onde algo
 * mudou.
 *
 * Best-effort e isolado por servidor: falha num servidor nao trava os outros,
 * e nada aqui segura o anuncio de presenca que ja saiu (por isso quem chama
 * usa `void`).
 */
async function sincronizarCargosDeJogo(
  io: AetherServer,
  userId: string,
  serverIds: string[],
  jogo: string | null,
): Promise<void> {
  for (const serverId of serverIds) {
    try {
      if (await sincronizarCargoPorJogo(userId, serverId, jogo)) {
        await resyncEavisarServidor(io, serverId);
      }
    } catch (erro) {
      log.warn(
        "gateway.cargo_por_jogo.falhou",
        "não sincronizei o cargo por jogo",
        { err: erro, userId, serverId },
      );
    }
  }
}

/**
 * Limite dos eventos de presenca.
 *
 * O que torna estes eventos caros nao e o custo de UM, e a AMPLIFICACAO: cada
 * `presence:game` vira uma emissao para cada amigo e para cada servidor em
 * comum, e ainda pode disparar uma busca de metadados do jogo. Uma mensagem
 * que entra vira dezenas que saem — quem abusa gasta pouco e o servidor gasta
 * muito, que e a forma barata de derrubar um gateway.
 *
 * Trocar de jogo e algo que acontece em minutos, nao em milissegundos. 10 de
 * rajada cobre o app inteiro se re-sincronizando ao conectar; 1 por segundo
 * em regime e folgado para qualquer uso honesto.
 */
const presenceLimiter = createRateLimiter({ capacity: 10, refillPerSecond: 1 });

/**
 * `server:join` e separado porque tem outro perfil: entrar em sala e barato,
 * mas cada chamada le o acesso do membro no Postgres e recalcula os canais
 * visiveis. Um app abrindo do zero pede varios servidores em sequencia — dai a
 * rajada alta — mas nao ha uso honesto que sustente isso continuamente.
 */
const joinRoomLimiter = createRateLimiter({ capacity: 30, refillPerSecond: 2 });

/**
 * `friend:voice-sync` le a localizacao de voz de cada amigo e, para os que
 * estao em call, o acesso de quem pediu — o mais caro dos pedidos de amigos.
 * O uso honesto e um por conexao (e um quando a lista de amigos muda).
 */
const vozDosAmigosLimiter = createRateLimiter({
  capacity: 4,
  refillPerSecond: 0.2,
});

export function registerPresenceHandlers(
  io: AetherServer,
  socket: AetherSocket,
  spotify?: { observar(userId: string): void; esquecer(userId: string): void },
): void {
  const { userId } = socket.data;

  // Passa a acompanhar o Spotify desta pessoa (idempotente).
  spotify?.observar(userId);

  socket.on("server:join", async (serverId, ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;

    if (typeof serverId !== "string" || serverId.length === 0) {
      respond({ ok: false, error: "servidor invalido" });
      return;
    }

    // Antes de ir ao banco: recusar depois da consulta ja teria pago o custo.
    if (!joinRoomLimiter.take(userId)) {
      respond({ ok: false, error: "muitas entradas seguidas" });
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
        participants: await voiceOfServer(serverId),
      });

      const becamePresent = await joinServer(socket.id, serverId);
      // A propria presenca entra na lista antes de responder, senao o cliente
      // se veria offline ate o proximo evento.
      respond({ ok: true, presence: await presenceOf(serverId) });

      if (becamePresent) {
        const meuStatus = await statusOf(userId);
        await announce(io, serverId, userId, meuStatus);
        /**
         * Cargo por jogo de quem JA estava jogando ao abrir este servidor: o
         * `presence:game` saiu antes, sem este servidor na lista. Invisivel
         * conta como sem jogo (o cargo revelaria o jogo escondido).
         */
        const jogo =
          meuStatus === "OFFLINE"
            ? null
            : (await presenceEntryOf(userId))?.game ?? null;
        if (jogo) void sincronizarCargosDeJogo(io, userId, [serverId], jogo);
      }
    } catch (error) {
      log.error("gateway.server.join", "server:join falhou", {
        err: error,
        userId,
        socketId: socket.id,
      });
      respond({ ok: false, error: "falha ao entrar no servidor" });
    }
  });

  socket.on("server:leave", async (serverId) => {
    if (typeof serverId !== "string") return;
    const left = await leaveServer(socket.id, serverId);
    await socket.leave(room.server(serverId));
    if (left) {
      await announce(io, serverId, userId, "OFFLINE");
      // Mesmo criterio do disconnect: fora do servidor, sem cargo por jogo.
      void sincronizarCargosDeJogo(io, userId, [serverId], null);
    }
  });

  socket.on("presence:set", async (status) => {
    if (!isUserStatus(status)) return;
    if (!presenceLimiter.take(userId)) return;

    const affected = await setStatus(userId, status);
    for (const serverId of affected) await announce(io, serverId, userId, status);
    // Amigo ve o status mesmo sem servidor em comum — e essa e a unica coisa
    // que ele ve por este caminho.
    await announceToFriends(io, userId, status, await friendsOf(userId));

    // Invisivel tambem esconde a call da tela Amigos (e voltar a mostra).
    void reavaliarVozDe(io, userId).catch(() => undefined);

    /**
     * Cargo por jogo acompanha a visibilidade: ficar invisivel tira o cargo
     * (ele revelaria o jogo escondido), voltar a aparecer devolve conforme o
     * jogo do momento.
     */
    const jogoAgora =
      status === "OFFLINE"
        ? null
        : (await presenceEntryOf(userId))?.game ?? null;
    void sincronizarCargosDeJogo(io, userId, affected, jogoAgora);

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
      .catch((error) =>
        log.warn("gateway.presence.set", "presence:set não persistiu", {
          err: error,
          userId,
        }),
      );
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
  socket.on("presence:game", async (payload) => {
    if (!presenceLimiter.take(userId)) return;

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

    const mudou = await setGame(userId, nome, icone);
    if (!mudou) return;

    /**
     * As OUTRAS abas da propria pessoa (o navegador nao detecta jogo) ficam
     * sabendo o que ela esta jogando — e o que habilita "Convidar para jogar"
     * fora do app de desktop.
     */
    io.to(room.user(userId)).emit("presence:self", { game: nome });

    const meuStatus = await statusOf(userId);
    const visivel = await entryVisivel(userId, meuStatus);
    for (const serverId of mudou.servers) {
      io.to(room.server(serverId)).emit("presence:update", {
        serverId,
        entry: visivel,
      });
    }
    await announceToFriends(io, userId, meuStatus, await friendsOf(userId));

    /**
     * Cargo automatico por jogo. `nome` e o cru (podado) — `sincronizarCargo
     * PorJogo` normaliza e casa. `null` (jogo fechado) tira o cargo. Invisivel
     * conta como sem jogo: quando `meuStatus` e OFFLINE, o cargo revelaria o
     * jogo que a pessoa escolheu esconder.
     */
    void sincronizarCargosDeJogo(
      io,
      userId,
      mudou.servers,
      meuStatus === "OFFLINE" ? null : nome,
    );

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
    if (nome && mudou.nomeMudou) void enriquecer(io, userId, nome);
  });

  /**
   * Foto das calls dos amigos, ja filtrada para quem pediu (ver
   * `voz/voz-de-amigos.ts`). Recusa por ritmo devolve `ok: false`, e NAO
   * lista vazia: a tela substitui o mapa pela foto, e uma lista vazia apagaria
   * as calls que ela ja mostrava.
   */
  socket.on("friend:voice-sync", async (ack) => {
    const respond = typeof ack === "function" ? ack : () => undefined;
    if (!vozDosAmigosLimiter.take(userId)) {
      respond({ ok: false });
      return;
    }
    try {
      respond({ ok: true, entries: await vozDosAmigos(userId) });
    } catch (erro) {
      log.warn("gateway.voz_de_amigos.sync", "friend:voice-sync falhou", {
        err: erro,
        userId,
      });
      respond({ ok: false });
    }
  });

  socket.on("disconnect", () => {
    void (async () => {
      /**
       * A lista de amigos e lida ANTES de desmontar: `detachSocket` apaga a
       * entrada do usuario quando cai o ultimo socket dele, e ai nao haveria
       * mais a quem avisar. Foi por isso que `announceToFriends` recebe os ids
       * por parametro em vez de busca-los sozinha.
       */
      const amigos = await friendsOf(userId);
      const { vacatedServers } = await detachSocket(socket.id);

      // Fechar uma aba de tres nao e sair de lugar nenhum: nada a anunciar.
      if (vacatedServers.length === 0 && (await isConnected(userId))) return;

      /**
       * Carencia (G-1): espera alguns segundos antes de anunciar, e anuncia
       * so o que continuou vazio. Uma queda curta de rede nao faz a pessoa
       * sumir e voltar para todo mundo. Ver `carencia-offline.ts`.
       */
      const saida = await confirmarSaida(userId, vacatedServers, carenciaOfflineMs(), {
        esperar: (ms) => new Promise((ok) => setTimeout(ok, ms)),
        isConnected,
        estaNoServidor: async (serverId, id) =>
          (await presenceOf(serverId)).some((e) => e.userId === id),
      });

      for (const serverId of saida.servidores) {
        await announce(io, serverId, userId, "OFFLINE");
      }
      /**
       * Saiu de vez de um servidor (ultimo socket, e nao voltou na carencia)
       * — tira o cargo por jogo. Fechar uma aba de tres nao mexe, a pessoa
       * continua jogando pelas outras.
       */
      if (saida.servidores.length > 0) {
        await sincronizarCargosDeJogo(io, userId, saida.servidores, null);
      }
      /**
       * So avisa os amigos quando nao sobrou socket NENHUM depois da
       * carencia. Fechar uma das tres abas nao e ficar offline — e o mesmo
       * criterio que `joinServer`/`leaveServer` ja aplicam por servidor.
       */
      if (saida.totalmenteFora) {
        await announceToFriends(io, userId, "OFFLINE", amigos);
        // Ultimo socket caiu: para de consultar o Spotify desta pessoa.
        spotify?.esquecer(userId);
      }
    })().catch((erro) => {
      log.error("gateway.presence.disconnect", "disconnect (presence) falhou", {
        err: erro,
        userId,
        socketId: socket.id,
      });
    });
  });
}
