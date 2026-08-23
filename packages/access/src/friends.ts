import { prisma } from "@aether/db";

/**
 * Quem e amigo de quem.
 *
 * Mora aqui, e nao no app web, pela mesma razao das permissoes de servidor: o
 * gateway TAMBEM precisa desta resposta, para saber a quem entregar a presenca
 * de alguem. Duas copias da regra divergem, e uma divergencia aqui significa
 * presenca chegando a quem nao deveria receber — falha de privacidade, nao
 * tela desatualizada.
 *
 * A relacao e guardada em UMA linha por par, com `requesterId`/`addresseeId`
 * marcando quem pediu. Depois de aceita nao ha mais lado: toda consulta abaixo
 * olha as duas colunas.
 */

/**
 * Ids dos amigos ACEITOS. Pedido pendente nao entra: quem so pediu ainda nao
 * tem direito de ver nada.
 */
export async function loadFriendIds(userId: string): Promise<string[]> {
  const linhas = await prisma.friendship.findMany({
    where: {
      status: "ACCEPTED",
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    select: { requesterId: true, addresseeId: true },
  });
  return linhas.map((linha) =>
    linha.requesterId === userId ? linha.addresseeId : linha.requesterId,
  );
}

/**
 * A relacao entre duas contas, em QUALQUER direcao e qualquer status.
 *
 * As duas direcoes numa consulta so — e nao "procura A->B, se nao achar
 * procura B->A" — porque o segundo caminho e facil de esquecer em quem chama,
 * e esquecer significa criar um pedido duplicado do par invertido, que o
 * indice unico (que e por direcao) nao barraria.
 */
export async function findFriendship(
  a: string,
  b: string,
): Promise<{
  id: string;
  requesterId: string;
  addresseeId: string;
  status: "PENDING" | "ACCEPTED";
} | null> {
  return prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
    select: {
      id: true,
      requesterId: true,
      addresseeId: true,
      status: true,
    },
  });
}

/** Os dois sao amigos aceitos? */
export async function areFriends(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const relacao = await findFriendship(a, b);
  return relacao?.status === "ACCEPTED";
}
