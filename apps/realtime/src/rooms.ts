import { prisma } from "@aether/db";
import {
  getChannelPermissionMap,
  loadMemberAccess,
  type MemberAccess,
} from "@aether/access";
import { has, room } from "@aether/shared";
import type { AetherServer } from "./types";

/**
 * Traducao de permissao para sala.
 *
 * Filtrar por sala, e nao por evento, e o que faz canal privado continuar
 * privado no tempo real: a decisao acontece UMA vez, quando o socket entra, e
 * a partir dai o gateway simplesmente emite para a sala. Nao existe caminho em
 * que um emit "esquece" de checar permissao, porque o emit nao checa nada — a
 * lista de quem esta na sala ja e a resposta.
 */
export async function visibleChannelRooms(
  access: MemberAccess,
): Promise<string[]> {
  const permissions = await getChannelPermissionMap(access);
  const rooms: string[] = [];
  for (const [channelId, bits] of permissions) {
    if (has(bits, "VIEW_CHANNEL")) rooms.push(room.channel(channelId));
  }
  return rooms;
}

/**
 * Recalcula, para todo socket ja presente num servidor, quais salas de canal
 * ele deveria ocupar agora.
 *
 * Por que existe: `visibleChannelRooms` so roda uma vez, no `server:join`.
 * Cargo editado, cargo atribuido/removido, canal virando privado ou o acesso
 * de um canal privado mudando — nenhum desses recalcula quem ja esta
 * conectado. Sem isto, tirar VIEW_CHANNEL de um cargo no meio da sessao ainda
 * deixaria quem tem esse cargo RECEBENDO o canal ate reconectar: a escrita ja
 * era revalidada a cada acao, mas a leitura ficava velha.
 *
 * Server-wide, e nao por usuario: mudanca de permissao pode afetar qualquer
 * um que tenha aquele cargo, e resincronizar todo mundo do servidor e uma
 * consulta barata — bem mais simples do que rastrear, em cada ponto de
 * chamada, quais membros o cargo ou o overwrite alcança.
 */
export async function resyncServerRooms(
  io: AetherServer,
  serverId: string,
): Promise<void> {
  const serverRoom = room.server(serverId);
  const socketIds = io.sockets.adapter.rooms.get(serverRoom);
  if (!socketIds || socketIds.size === 0) return;

  const channels = await prisma.channel.findMany({
    where: { serverId },
    select: { id: true },
  });
  const allChannelRooms = new Set(channels.map((c) => room.channel(c.id)));

  // Um usuario com varias abas so precisa ser recalculado uma vez.
  const seenUsers = new Map<string, string[] | null>();

  for (const socketId of socketIds) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;

    const { userId } = socket.data;
    if (!seenUsers.has(userId)) {
      const access = await loadMemberAccess(serverId, userId);
      seenUsers.set(userId, access ? await visibleChannelRooms(access) : null);
    }

    const desired = seenUsers.get(userId);
    // `null` = nao e mais membro. Quem chama a acao de moderacao (kick/ban)
    // ja usa o /internal/evict para este caso; aqui so defende contra a
    // corrida de alguem sair no meio do recalculo.
    if (desired === null) continue;

    const desiredSet = new Set(desired);
    const current = [...socket.rooms].filter((r) => allChannelRooms.has(r));

    await Promise.all([
      ...current
        .filter((r) => !desiredSet.has(r))
        .map((r) => socket.leave(r)),
      ...[...desiredSet]
        .filter((r) => !current.includes(r))
        .map((r) => socket.join(r)),
    ]);
  }
}
