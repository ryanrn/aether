import type { Namespace, Socket } from "socket.io";
import { prisma } from "@aether/db";
import { loadMemberAccess, resolveBotToken } from "@aether/access";
import {
  room,
  type BotGatewayClientEvents,
  type BotGatewayServerEvents,
  type BotSocketData,
  type DispatchDeBot,
} from "@aether/shared";
import { log } from "@aether/shared/log";
import type { AetherServer } from "./types";
import { visibleChannelRooms } from "./rooms";
import { socketsAcimaDoTeto } from "./socket-cap";

/**
 * Bot Gateway — o namespace `/gateway` onde os bots RECEBEM eventos.
 *
 * MESMO processo, mesma porta, mesmo Socket.IO do app humano — so um namespace
 * a mais. NAO interfere nas conexoes humanas: o `io.use`/`io.on("connection")`
 * do `index.ts` valem so para o namespace default; este tem os seus proprios.
 *
 * As SALAS sao por namespace: `channel:<id>` aqui e um conjunto DIFERENTE de
 * `channel:<id>` no default. Isso e isolamento de graca — `message:new` do
 * chat humano nao vaza para ca. A Etapa 10 emite `dispatch` explicitamente
 * para as salas deste namespace.
 *
 * Sem RESUME: reconectar refaz o handshake, o carregamento e o join. O bot
 * reconcilia o que perdeu pela REST.
 */

/** Teto de conexoes simultaneas por aplicacao. Folga para uma reconexao. */
const MAX_CONEXOES_POR_APP = 2;
const HEARTBEAT_MS = 20_000;

type BotNamespace = Namespace<
  BotGatewayClientEvents,
  BotGatewayServerEvents,
  Record<string, never>,
  BotSocketData
>;
type BotSocket = Socket<
  BotGatewayClientEvents,
  BotGatewayServerEvents,
  Record<string, never>,
  BotSocketData
>;

/** O namespace `/gateway`, com os tipos certos. */
export function botNamespace(io: AetherServer): BotNamespace {
  return io.of("/gateway") as unknown as BotNamespace;
}

/**
 * Entrega um evento aos bots que ESTAO na sala do canal — ou seja, que
 * enxergam o canal E pediram `messages` no handshake. Chamado pelo
 * `domain-events.ts` sempre que uma mensagem entra num canal de servidor.
 */
export function dispatchParaBots(
  io: AetherServer,
  channelId: string,
  payload: DispatchDeBot,
): void {
  botNamespace(io).to(room.channel(channelId)).emit("dispatch", payload);
}

export function registrarBotGateway(io: AetherServer): void {
  const nsp = botNamespace(io);

  /** appId -> socketIds locais. Teto por instancia, como `maxSocketsPorUsuario`. */
  const porApp = new Map<string, Set<string>>();

  nsp.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const identidade =
        typeof token === "string" ? await resolveBotToken(token) : null;
      if (!identidade) {
        next(new Error("unauthorized"));
        return;
      }

      /**
       * `intents` ausente = tudo (hoje so `["messages"]`). `intents: []`
       * explicito = nada — o bot conecta, recebe `ready` e mais nada. A Etapa
       * 10 usa isto para decidir se entra nas salas de canal.
       */
      const brutos = socket.handshake.auth?.intents;
      const intents = Array.isArray(brutos)
        ? brutos.filter((i): i is string => typeof i === "string")
        : ["messages"];

      socket.data = {
        applicationId: identidade.applicationId,
        botUserId: identidade.botUserId,
        intents,
      };
      next();
    } catch (erro) {
      log.error("gateway.bot.handshake", "handshake de bot falhou", {
        err: erro,
        socketId: socket.id,
      });
      next(new Error("unauthorized"));
    }
  });

  nsp.on("connection", (socket) => {
    const { applicationId } = socket.data;

    const set = porApp.get(applicationId) ?? new Set<string>();
    set.add(socket.id);
    porApp.set(applicationId, set);

    for (const velho of socketsAcimaDoTeto(
      [...set],
      socket.id,
      MAX_CONEXOES_POR_APP,
    )) {
      nsp.sockets.get(velho)?.disconnect(true);
    }

    socket.on("disconnect", () => {
      set.delete(socket.id);
      if (set.size === 0) porApp.delete(applicationId);
      if (!process.env.NODE_ENV || process.env.NODE_ENV !== "production") {
        console.log(`[bot-gateway] saiu app=${applicationId}`);
      }
    });

    void iniciarBot(socket).catch((erro) => {
      log.error("gateway.bot.iniciar", "não iniciei o bot", {
        err: erro,
        socketId: socket.id,
        applicationId,
      });
      socket.disconnect(true);
    });
  });
}

/**
 * Carrega a aplicacao e as instalacoes, junta o socket nas salas dos canais
 * visiveis, e emite `ready`. Exportada para o teste.
 */
export async function iniciarBot(socket: BotSocket): Promise<void> {
  const { applicationId, botUserId } = socket.data;

  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      name: true,
      blockedAt: true,
      bot: { select: { id: true, username: true, displayName: true } },
    },
  });

  // Token valido mas app apagada/bloqueada/sem bot entre o resolve e aqui.
  if (!app || app.blockedAt !== null || !app.bot) {
    socket.disconnect(true);
    return;
  }

  const installs = await prisma.installation.findMany({
    where: { applicationId, revokedAt: null },
    select: { serverId: true, server: { select: { name: true } } },
  });

  /**
   * Filtro grosso de intent: o bot so entra nas salas de canal (e portanto so
   * recebe `MESSAGE_CREATE`) se pediu `messages`. Sem iterar socket a socket em
   * cada emit — a decisao acontece UMA vez, aqui.
   */
  const querMensagens = socket.data.intents.includes("messages");

  const servers: Array<{ id: string; name: string }> = [];
  for (const inst of installs) {
    /**
     * O bot pode ter sido removido do servidor (kick, ou o cargo dele perdeu
     * tudo) entre instalar e conectar. Sem `MemberAccess` nao ha salas a juntar.
     */
    const access = await loadMemberAccess(inst.serverId, botUserId);
    if (!access) continue;

    if (querMensagens) {
      for (const sala of await visibleChannelRooms(access)) {
        void socket.join(sala);
      }
    }
    servers.push({ id: inst.serverId, name: inst.server.name });
  }

  socket.emit("ready", {
    application: { id: app.id, name: app.name },
    bot: {
      id: app.bot.id,
      username: app.bot.username,
      displayName: app.bot.displayName,
    },
    servers,
    heartbeatMs: HEARTBEAT_MS,
  });
}
