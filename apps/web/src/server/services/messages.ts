import "server-only";

import { prisma } from "@aether/db";
import {
  MESSAGE_PAGE_SIZE,
  toPublicMessage,
  type PublicMessage,
} from "@aether/shared";

/**
 * Historico inicial do canal, carregado no SSR.
 *
 * Por que aqui e nao pelo socket: a pagina do canal ja e server component e ja
 * fala com o banco. Buscar as primeiras mensagens junto do resto evita a tela
 * vazia piscando e uma ida de rede a mais no carregamento. O socket cuida do
 * que vier depois, e a paginacao para tras tambem passa por ele.
 *
 * Sem checagem de permissao aqui de proposito: quem chama ja passou pelos
 * guards da pagina. Mesma convencao dos outros services.
 */
export async function listRecentMessages(channelId: string, selfUserId: string) {
  return historicoInicial({ channelId, deletedAt: null }, selfUserId);
}

/**
 * O mesmo, para uma conversa direta.
 *
 * Filtra pela COLUNA certa, e nao por um id solto: como as duas colunas de pai
 * sao nulaveis, passar um id de conversa em `channelId` nao daria erro —
 * devolveria zero linhas, e historico vazio parece "conversa nova" em vez de
 * bug.
 */
export async function listRecentDmMessages(dmChannelId: string, selfUserId: string) {
  return historicoInicial({ dmChannelId, deletedAt: null }, selfUserId);
}

async function historicoInicial(
  where: { channelId?: string; dmChannelId?: string; deletedAt: null },
  /** Quem esta olhando, para marcar quais reacoes sao suas. */
  selfUserId: string,
): Promise<{
  messages: PublicMessage[];
  hasMore: boolean;
}> {
  const rows = await prisma.message.findMany({
    where,
    select: {
      id: true,
      channelId: true,
      dmChannelId: true,
      reactions: { select: { emoji: true, userId: true } },
      content: true,
      createdAt: true,
      editedAt: true,
      author: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          status: true,
        },
      },
    },
    // As mais recentes primeiro para o banco usar o indice de (pai, createdAt)
    // e nao varrer tudo; a ordem para a tela e invertida abaixo.
    orderBy: { createdAt: "desc" },
    take: MESSAGE_PAGE_SIZE + 1,
  });

  const hasMore = rows.length > MESSAGE_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, MESSAGE_PAGE_SIZE) : rows;

  return {
    messages: page.map((row) => toPublicMessage(row, selfUserId)).reverse(),
    hasMore,
  };
}
