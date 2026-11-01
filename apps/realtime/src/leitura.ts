import { Prisma, prisma } from "@aether/db";
import { getChannelPermissionMap, loadMemberAccess } from "@aether/access";
import { has, room, type NaoLidasIniciais } from "@aether/shared";
import type { AetherServer } from "./types";
import { autorizarConversa } from "./enviar-mensagem";

/**
 * Nao lidas persistidas (P1-3).
 *
 * Duas operacoes: CONTAR (uma vez por conexao, `read:state`) e MARCAR
 * (`read:mark`, quando a pessoa le). A tabela e `ReadState`; o porque de
 * cada coluna esta no schema.
 *
 * A permissao nao e reimplementada aqui: contar usa o mesmo
 * `getChannelPermissionMap` que decide as salas do socket, e marcar passa
 * pela mesma `autorizarConversa` do chat.
 */

/**
 * A partir de quando contar. Com linha salva, ela manda. Sem linha (canal
 * criado depois, membro novo, conversa nova), conta do momento em que a
 * pessoa passou a ter acesso — antes disso ela nao podia ter lido nada.
 */
export function inicioDaContagem(
  salvo: Date | undefined,
  acessoDesde: Date[],
): Date {
  if (salvo) return salvo;
  return new Date(Math.max(...acessoDesde.map((d) => d.getTime())));
}

/** Quantas contagens ao banco ao mesmo tempo, para nao esgotar o pool. */
const LOTE = 8;

async function emLotes<T, R>(
  itens: T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const saida: R[] = [];
  for (let i = 0; i < itens.length; i += LOTE) {
    saida.push(...(await Promise.all(itens.slice(i, i + LOTE).map(fn))));
  }
  return saida;
}

export async function calcularNaoLidas(
  userId: string,
): Promise<NaoLidasIniciais> {
  const [membros, dms, salvos] = await Promise.all([
    prisma.serverMember.findMany({
      where: { userId },
      select: { serverId: true, joinedAt: true },
    }),
    prisma.dmChannel.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      select: { id: true, createdAt: true },
    }),
    prisma.readState.findMany({
      where: { userId },
      select: { channelId: true, dmChannelId: true, lastReadAt: true },
    }),
  ]);

  const lidoEm = new Map<string, Date>();
  for (const s of salvos) {
    const id = s.channelId ?? s.dmChannelId;
    if (id) lidoEm.set(id, s.lastReadAt);
  }

  const serverDoCanal: Record<string, string> = {};
  const alvos: { id: string; tipo: "canal" | "dm"; desde: Date }[] = [];

  for (const { serverId, joinedAt } of membros) {
    const access = await loadMemberAccess(serverId, userId);
    if (!access) continue;
    const [permissoes, canais] = await Promise.all([
      getChannelPermissionMap(access),
      prisma.channel.findMany({
        where: { serverId, type: "TEXT" },
        select: { id: true, createdAt: true },
      }),
    ]);
    for (const canal of canais) {
      const bits = permissoes.get(canal.id);
      if (bits === undefined || !has(bits, "VIEW_CHANNEL")) continue;
      serverDoCanal[canal.id] = serverId;
      alvos.push({
        id: canal.id,
        tipo: "canal",
        desde: inicioDaContagem(lidoEm.get(canal.id), [joinedAt, canal.createdAt]),
      });
    }
  }

  for (const dm of dms) {
    alvos.push({
      id: dm.id,
      tipo: "dm",
      desde: inicioDaContagem(lidoEm.get(dm.id), [dm.createdAt]),
    });
  }

  const contagens = await emLotes(alvos, (alvo) =>
    prisma.message.count({
      where: {
        ...(alvo.tipo === "canal"
          ? { channelId: alvo.id }
          : { dmChannelId: alvo.id }),
        createdAt: { gt: alvo.desde },
        deletedAt: null,
        // A propria mensagem nunca e "nao lida".
        authorId: { not: userId },
      },
    }),
  );

  const naoLidas: Record<string, number> = {};
  alvos.forEach((alvo, i) => {
    if (contagens[i]! > 0) naoLidas[alvo.id] = contagens[i]!;
  });

  return { naoLidas, serverDoCanal };
}

/**
 * Marca a conversa como lida ate `messageId`. Devolve `false` para qualquer
 * recusa (sem acesso, mensagem de outra conversa, apagada, inexistente) —
 * todas iguais, como no resto do chat.
 *
 * A data salva SO AVANCA. Duas abas, ou um evento atrasado, podem pedir para
 * marcar uma mensagem mais antiga que a ja salva; isso nunca pode devolver
 * nao lidas que ja foram vistas.
 */
export async function marcarLeitura(
  io: AetherServer,
  userId: string,
  conversationId: unknown,
  messageId: unknown,
): Promise<boolean> {
  if (typeof conversationId !== "string" || typeof messageId !== "string") {
    return false;
  }

  const conversa = await autorizarConversa(userId, conversationId, "VIEW_CHANNEL");
  if (!conversa) return false;

  const ehCanal = conversa.tipo === "canal";
  const msg = await prisma.message.findFirst({
    where: {
      id: messageId,
      deletedAt: null,
      ...(ehCanal ? { channelId: conversationId } : { dmChannelId: conversationId }),
    },
    select: { createdAt: true },
  });
  if (!msg) return false;

  const chave = ehCanal
    ? { userId, channelId: conversationId }
    : { userId, dmChannelId: conversationId };

  const avancar = () =>
    prisma.readState.updateMany({
      where: { ...chave, lastReadAt: { lt: msg.createdAt } },
      data: { lastReadAt: msg.createdAt },
    });

  const { count } = await avancar();
  if (count === 0) {
    const existe = await prisma.readState.findFirst({
      where: chave,
      select: { id: true },
    });
    // Existe e ja estava igual ou a frente: nada a fazer, e nada a avisar.
    if (existe) return true;
    try {
      await prisma.readState.create({
        data: { ...chave, lastReadAt: msg.createdAt },
      });
    } catch (erro) {
      // Outra aba criou a linha no mesmo instante: o unique barrou; avanca a dela.
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === "P2002"
      ) {
        await avancar();
      } else {
        throw erro;
      }
    }
  }

  io.to(room.user(userId)).emit("read:updated", {
    conversationId,
    lastReadAt: msg.createdAt.toISOString(),
  });
  return true;
}
