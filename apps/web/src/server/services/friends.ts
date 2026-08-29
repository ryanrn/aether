import "server-only";
import { prisma } from "@aether/db";
import {
  SELECT_USUARIO_PUBLICO,
  toPublicUser,
  type PublicFriendship,
} from "@aether/shared";

/**
 * Consultas de amizade. So leitura — quem muda estado e
 * `server/actions/friends.ts`, e quem responde "os dois sao amigos?" e
 * `@aether/access`, porque o gateway precisa da mesma resposta.
 */

/**
 * Todas as amizades de alguem — aceitas e pendentes, nas duas direcoes.
 *
 * Uma consulta so, e nao tres, porque as tres listas da tela (amigos,
 * recebidos, enviados) sao recortes do mesmo conjunto: separar em consultas
 * diferentes daria tres chances de esquecer de olhar as duas colunas.
 *
 * O `status` que vai para a tela e o do BANCO (a preferencia), nao o de quem
 * esta online agora: isso e do gateway, e chega pelo socket. Aqui ele serve
 * so como valor inicial ate o primeiro `friend:sync`.
 */
export async function listFriendships(
  userId: string,
): Promise<PublicFriendship[]> {
  const linhas = await prisma.friendship.findMany({
    where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: {
      id: true,
      status: true,
      createdAt: true,
      requesterId: true,
      requester: { select: SELECT_USUARIO_PUBLICO },
      addressee: { select: SELECT_USUARIO_PUBLICO },
    },
    orderBy: { createdAt: "desc" },
  });

  /**
   * Bloqueados entram na MESMA lista, com `kind: "blocked"`.
   *
   * Nao ha linha de `Friendship` para eles — bloquear apaga a amizade — entao
   * eles viriam de lugar nenhum se a busca parasse aqui. O `id` usado e o do
   * proprio bloqueio, que e o que a tela precisa para ter chave estavel.
   */
  const bloqueios = await prisma.block.findMany({
    where: { blockerId: userId },
    select: {
      id: true,
      createdAt: true,
      blocked: { select: SELECT_USUARIO_PUBLICO },
    },
    orderBy: { createdAt: "desc" },
  });

  const bloqueados: PublicFriendship[] = bloqueios.map((linha) => ({
    id: linha.id,
    user: toPublicUser(linha.blocked),
    kind: "blocked" as const,
    createdAt: linha.createdAt.toISOString(),
  }));

  const amizades = linhas.map((linha) => {
    const euPedi = linha.requesterId === userId;
    const outro = euPedi ? linha.addressee : linha.requester;
    return {
      id: linha.id,
      user: toPublicUser(outro),
      kind:
        linha.status === "ACCEPTED"
          ? ("friend" as const)
          : euPedi
            ? ("outgoing" as const)
            : ("incoming" as const),
      createdAt: linha.createdAt.toISOString(),
    };
  });

  return [...amizades, ...bloqueados];
}

/** Quantos pedidos esperam decisao SUA — o numerinho no menu lateral. */
export async function countIncomingRequests(userId: string): Promise<number> {
  return prisma.friendship.count({
    where: { addresseeId: userId, status: "PENDING" },
  });
}
