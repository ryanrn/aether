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
 *
 * `io.in(sala).fetchSockets()`, e NAO `io.sockets.adapter.rooms.get` +
 * `io.sockets.sockets.get` (fase 7c-2): o adapter em memoria so guarda
 * localmente quem esta NESTA instancia, e com mais de uma maquina de
 * gateway metade das pessoas do servidor simplesmente nao seria recalculada.
 * `fetchSockets()` e o metodo do proprio Socket.IO para isto — devolve
 * sockets de QUALQUER instancia (com o adapter de Redis) e continua
 * funcionando sem ele, exatamente como antes.
 */
export async function resyncServerRooms(
  io: AetherServer,
  serverId: string,
): Promise<void> {
  const serverRoom = room.server(serverId);
  const sockets = await io.in(serverRoom).fetchSockets();
  if (sockets.length === 0) return;

  const channels = await prisma.channel.findMany({
    where: { serverId },
    select: { id: true },
  });
  const allChannelRooms = new Set(channels.map((c) => room.channel(c.id)));

  // Um usuario com varias abas so precisa ser recalculado uma vez.
  const seenUsers = new Map<string, string[] | null>();

  for (const socket of sockets) {
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

/**
 * Coloca o socket nas salas de TODOS os servidores da pessoa, logo na conexao.
 *
 * POR QUE ISTO EXISTE: ate aqui, so o servidor ABERTO entrava em sala — o
 * `server:join` roda pela rota. A consequencia e que mensagem de qualquer
 * outro servidor simplesmente nao chegava ao cliente, e por isso nao havia
 * como acender um contador de nao lidas no icone dele: o app nunca ficava
 * sabendo que algo aconteceu ali.
 *
 * SO AS SALAS, e nao o resto do `server:join`. Aquele tambem marca presenca e
 * manda `voice:sync`; fazer isso para todos os servidores mudaria
 * comportamento (a pessoa apareceria "presente" em todos ao conectar) e
 * mandaria estado de voz que ninguem pediu. Aqui e so ouvir.
 *
 * A PERMISSAO CONTINUA SENDO A MESMA: `visibleChannelRooms` decide, exatamente
 * como no `server:join`. Canal privado que a pessoa nao ve nao vira sala, e
 * portanto nao vira notificacao — se o contador acendesse por um canal
 * invisivel, ele estaria contando o que a pessoa nao pode saber que existe.
 *
 * `socket.join` de sala repetida e no-op, entao o `server:join` seguinte nao
 * refaz trabalho nem atrapalha.
 */
export async function joinAllServerRooms(
  socket: { data: { userId: string }; join: (room: string) => unknown },
): Promise<void> {
  const { userId } = socket.data;

  const membros = await prisma.serverMember.findMany({
    where: { userId },
    select: { serverId: true },
  });

  for (const { serverId } of membros) {
    const access = await loadMemberAccess(serverId, userId);
    if (!access) continue;
    socket.join(room.server(serverId));
    for (const channelRoom of await visibleChannelRooms(access)) {
      socket.join(channelRoom);
    }
  }
}
