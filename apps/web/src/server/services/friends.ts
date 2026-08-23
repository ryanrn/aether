import "server-only";
import { prisma } from "@aether/db";
import type { PublicFriendship } from "@aether/shared";

/**
 * Consultas de amizade. So leitura — quem muda estado e
 * `server/actions/friends.ts`, e quem responde "os dois sao amigos?" e
 * `@aether/access`, porque o gateway precisa da mesma resposta.
 */

const USUARIO_PUBLICO = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  status: true,
} as const;

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
      requester: { select: USUARIO_PUBLICO },
      addressee: { select: USUARIO_PUBLICO },
    },
    orderBy: { createdAt: "desc" },
  });

  return linhas.map((linha) => {
    const euPedi = linha.requesterId === userId;
    const outro = euPedi ? linha.addressee : linha.requester;
    return {
      id: linha.id,
      user: outro,
      kind:
        linha.status === "ACCEPTED"
          ? ("friend" as const)
          : euPedi
            ? ("outgoing" as const)
            : ("incoming" as const),
      createdAt: linha.createdAt.toISOString(),
    };
  });
}

/** Quantos pedidos esperam decisao SUA — o numerinho no menu lateral. */
export async function countIncomingRequests(userId: string): Promise<number> {
  return prisma.friendship.count({
    where: { addresseeId: userId, status: "PENDING" },
  });
}
