import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "@aether/db";
import { loadFriendIds } from "@aether/access";
import { room } from "@aether/shared";
import { env } from "./env";
import { resyncServerRooms } from "./rooms";
import type { AetherServer } from "./types";
import {
  isConnected,
  leaveVoice,
  presenceOfFriends,
  setFriends,
  socketIdsOf,
  voiceDeparture,
} from "./state";

/**
 * Porta de servico entre o app web e o gateway.
 *
 * Por que existe: o socket entra nas salas de um servidor quando a pessoa
 * entra nele, e nunca recalcula sozinho. Duas rotas, duas gravidades:
 *
 *  - `/internal/evict` — a pessoa deixou de ser membro (kick, ban, saiu).
 *    Tira o socket de TODAS as salas do servidor e avisa a interface dele.
 *  - `/internal/resync-rooms` — a pessoa continua membro, mas o que ela pode
 *    VER mudou (cargo editado, cargo atribuido, canal virou privado, acesso
 *    de canal privado mudou). Recalcula so as salas de canal, sem tirar
 *    ninguem do servidor nem avisar a interface — a mudanca de leitura e
 *    silenciosa, do mesmo jeito que ela ja era invisivel antes.
 *  - `/internal/friends-changed` — a lista de amizades de alguem mudou. O
 *    gateway guarda os amigos em memoria para nao consultar o banco a cada
 *    mudanca de presenca; sem este aviso, aceitar um pedido so passaria a
 *    valer na proxima reconexao dos dois.
 *
 * Sem a primeira, apagar a linha no banco nao bastava — a pessoa continuaria
 * recebendo o chat pelo socket ate recarregar a pagina: acesso indevido, nao
 * interface desatualizada. Sem a segunda, o mesmo valia para qualquer
 * mudanca de permissao que nao fosse remocao total.
 *
 * Quem chama e o servidor do Next, nunca o navegador. A autenticacao e o
 * AUTH_SECRET que os dois lados ja compartilham para validar sessao — sem
 * variavel nova para configurar errado.
 */

const HEADER = "x-aether-internal";

/** Comparacao em tempo constante: igualdade simples vaza o segredo por tempo. */
function secretMatches(provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(env.authSecret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      // Nada legitimo aqui passa de alguns bytes; corta payload absurdo.
      if (raw.length > 4096) reject(new Error("payload grande demais"));
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("json invalido"));
      }
    });
    request.on("error", reject);
  });
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/**
 * Tira o usuario das salas de um servidor e avisa a interface dele.
 *
 * Nao derruba a conexao inteira: a pessoa pode participar de outros servidores,
 * e desconectar tudo puniria o que nao tem relacao com a moderacao.
 */
async function evict(
  io: AetherServer,
  serverId: string,
  userId: string,
): Promise<number> {
  const socketIds = socketIdsOf(userId);
  if (socketIds.length === 0) return 0;

  // Precisamos dos canais para sair das salas certas: o socket pode estar em
  // salas de canal de OUTROS servidores, que nao devem ser tocadas.
  const channels = await prisma.channel.findMany({
    where: { serverId },
    select: { id: true },
  });
  const channelRooms = channels.map((channel) => room.channel(channel.id));

  const left = leaveVoice(userId);
  if (left && left.serverId === serverId) {
    io.to(room.server(serverId)).emit("voice:update", {
      serverId,
      participant: voiceDeparture(userId, left.user),
    });
  }

  let affected = 0;
  for (const socketId of socketIds) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;

    await socket.leave(room.server(serverId));
    for (const channelRoom of channelRooms) await socket.leave(channelRoom);

    socket.emit("server:evicted", {
      serverId,
      reason: "Voce nao faz mais parte deste servidor.",
    });
    affected += 1;
  }

  return affected;
}

/** Devolve `true` quando a requisicao foi tratada aqui. */
export async function handleInternalRequest(
  io: AetherServer,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  if (!request.url?.startsWith("/internal/")) return false;

  if (!secretMatches(request.headers[HEADER] as string | undefined)) {
    // Sem detalhe: quem chamou nao precisa saber se o caminho existe.
    json(response, 404, { ok: false });
    return true;
  }

  if (request.method !== "POST") {
    json(response, 404, { ok: false });
    return true;
  }

  if (request.url === "/internal/evict") {
    try {
      const body = (await readJsonBody(request)) as {
        serverId?: unknown;
        userId?: unknown;
      };
      if (typeof body.serverId !== "string" || typeof body.userId !== "string") {
        json(response, 400, { ok: false, error: "serverId e userId sao obrigatorios" });
        return true;
      }

      const affected = await evict(io, body.serverId, body.userId);
      json(response, 200, { ok: true, sockets: affected });
    } catch (error) {
      console.error("[gateway] /internal/evict falhou:", error);
      json(response, 500, { ok: false });
    }
    return true;
  }

  if (request.url === "/internal/resync-rooms") {
    try {
      const body = (await readJsonBody(request)) as { serverId?: unknown };
      if (typeof body.serverId !== "string") {
        json(response, 400, { ok: false, error: "serverId e obrigatorio" });
        return true;
      }

      await resyncServerRooms(io, body.serverId);

      /**
       * Avisa a interface DEPOIS de recalcular as salas, nunca antes: o
       * cliente vai pedir a arvore nova ao Next, e ela precisa concordar com
       * as salas em que o socket de fato esta. Na ordem inversa, alguem
       * poderia ver um canal na lista um instante antes de entrar na sala
       * dele — e clicar num canal que ainda nao entrega mensagem.
       */
      io.to(room.server(body.serverId)).emit("server:changed", {
        serverId: body.serverId,
      });

      json(response, 200, { ok: true });
    } catch (error) {
      console.error("[gateway] /internal/resync-rooms falhou:", error);
      json(response, 500, { ok: false });
    }
    return true;
  }

  if (request.url === "/internal/friends-changed") {
    try {
      const body = (await readJsonBody(request)) as { userIds?: unknown };
      const ids = Array.isArray(body.userIds)
        ? body.userIds.filter((id): id is string => typeof id === "string")
        : [];
      if (ids.length === 0) {
        json(response, 400, { ok: false, error: "userIds e obrigatorio" });
        return true;
      }

      let atualizados = 0;
      for (const userId of ids) {
        /**
         * Quem nao esta conectado nao tem estado em memoria para corrigir — e
         * vai carregar a lista nova no proximo `connection` de qualquer jeito.
         */
        if (!isConnected(userId)) continue;
        setFriends(userId, await loadFriendIds(userId));
        /**
         * Os dois eventos, e nesta ordem. `friend:changed` faz a tela pedir a
         * lista nova ao Next (que e quem sabe montar "pendente"/"aceito");
         * `friend:sync` reentrega a presenca de quem esta online agora, porque
         * um amigo recem-aceito ja pode estar conectado ha horas e nunca mais
         * emitiria um evento por conta propria.
         */
        io.to(room.user(userId)).emit("friend:changed");
        io.to(room.user(userId)).emit("friend:sync", {
          entries: presenceOfFriends(userId),
        });
        atualizados += 1;
      }

      json(response, 200, { ok: true, atualizados });
    } catch (error) {
      console.error("[gateway] /internal/friends-changed falhou:", error);
      json(response, 500, { ok: false });
    }
    return true;
  }

  json(response, 404, { ok: false });
  return true;
}
