import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "@aether/db";
import { room } from "@aether/shared";
import { env } from "./env";
import type { AetherServer } from "./types";
import { leaveVoice, socketIdsOf, voiceDeparture } from "./state";

/**
 * Porta de servico entre o app web e o gateway.
 *
 * Por que existe: o socket entra nas salas de um servidor quando a pessoa
 * entra nele, e nunca recalcula. Ao expulsar ou banir alguem, apagar a linha
 * no banco nao basta — a pessoa continuaria recebendo o chat pelo socket ate
 * recarregar a pagina. Isso e acesso indevido, nao interface desatualizada.
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

  if (request.method !== "POST" || request.url !== "/internal/evict") {
    json(response, 404, { ok: false });
    return true;
  }

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
