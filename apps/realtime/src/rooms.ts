import { getChannelPermissionMap, type MemberAccess } from "@aether/access";
import { has, room } from "@aether/shared";

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
