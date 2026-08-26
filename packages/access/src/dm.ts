import { prisma } from "@aether/db";
import { areFriends } from "./friends";

/**
 * Autorizacao das conversas diretas.
 *
 * A regra e curta, e curta de proposito: voce e um dos dois participantes, e
 * voces ainda sao amigos. Nao ha cargo, nao ha overwrite, nao ha hierarquia —
 * nada do que `getChannelPermissions` calcula faz sentido aqui.
 *
 * Foi por isso que a conversa NAO virou um `Channel` com `serverId` nulavel:
 * todo o modelo de permissao de canal se apoia em `MemberAccess` (servidor,
 * membro, cargos, overwrites), e uma conversa nao tem nenhum desses. Enfiar as
 * duas coisas na mesma funcao criaria um segundo caminho de decisao dentro da
 * funcao que existe para ser o unico.
 *
 * Mora aqui, e nao em cada app, porque `apps/web` e `apps/realtime` precisam
 * da MESMA resposta. Duas copias divergem, e permissao divergente e falha de
 * autorizacao.
 */

/**
 * O par na ordem em que o banco exige: menor id primeiro.
 *
 * Existe como funcao — em vez de um `.sort()` solto em cada chamada — porque a
 * ordem e uma regra do schema (`CHECK ("userAId" < "userBId")`), nao um
 * detalhe de quem grava. Um unico lugar esquecendo de ordenar criaria uma
 * segunda conversa para o mesmo par, e o indice unico nao teria como perceber.
 */
export function ordenarPar(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export interface DmAccess {
  dmId: string;
  /** A outra pessoa da conversa — quem chama ja sabe quem e ela mesma. */
  outroId: string;
}

/**
 * Voce pode ler e escrever nesta conversa?
 *
 * Devolve `null` para os dois casos que precisam ser indistinguiveis: a
 * conversa nao existe, ou existe e nao e sua. Quem chama responde 404 nos
 * dois, como no resto do sistema — dizer "essa conversa existe, mas nao e
 * sua" ja contaria que duas pessoas especificas se falam.
 *
 * A AMIZADE E RECHECADA A CADA CHAMADA, e nao so quando a conversa foi
 * aberta. Sem bloqueio no produto, desfazer a amizade e a UNICA forma de
 * alguem parar de receber mensagem de outra pessoa; se a checagem valesse so
 * na abertura, o canal continuaria aberto para sempre depois de aceito uma
 * vez. A conversa nao e apagada — refazendo a amizade, o historico volta.
 */
export async function loadDmAccess(
  userId: string,
  dmId: string,
): Promise<DmAccess | null> {
  if (typeof dmId !== "string" || dmId.length === 0) return null;

  const dm = await prisma.dmChannel.findUnique({
    where: { id: dmId },
    select: { id: true, userAId: true, userBId: true },
  });
  if (!dm) return null;

  const outroId =
    dm.userAId === userId
      ? dm.userBId
      : dm.userBId === userId
        ? dm.userAId
        : null;
  if (outroId === null) return null;

  if (!(await areFriends(userId, outroId))) return null;

  return { dmId: dm.id, outroId };
}

/**
 * As conversas de alguem, com quem esta do outro lado.
 *
 * Filtra por amizade DEPOIS de buscar, e nao no `where`, porque a amizade
 * mora em outra tabela sem relacao declarada com esta. Na escala deste
 * projeto — um grupo de amigos — sao dezenas de linhas, nao milhares.
 */
export async function loadDmList(
  userId: string,
): Promise<Array<{ dmId: string; outroId: string }>> {
  const linhas = await prisma.dmChannel.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true },
  });

  const amigos = new Set(
    (
      await prisma.friendship.findMany({
        where: {
          status: "ACCEPTED",
          OR: [{ requesterId: userId }, { addresseeId: userId }],
        },
        select: { requesterId: true, addresseeId: true },
      })
    ).map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId)),
  );

  return linhas
    .map((linha) => ({
      dmId: linha.id,
      outroId: linha.userAId === userId ? linha.userBId : linha.userAId,
    }))
    .filter((item) => amigos.has(item.outroId));
}
