import { prisma } from "@aether/db";

/**
 * Bloqueio entre duas pessoas.
 *
 * POR QUE ISTO EXISTE: ate aqui, a unica forma de parar de receber mensagem de
 * alguem era desfazer a amizade — e isso deixou de funcionar quando a conversa
 * a partir de servidor nasceu. Dividindo um servidor e com a chave ligada (o
 * padrao), desfazer amizade nao fechava nada. Desligar a chave resolvia, mas
 * cortando TODO MUNDO que nao e amigo, e nao a pessoa que incomoda.
 *
 * O bloqueio e a resposta por pessoa, e ele vem ANTES das duas portas de
 * `podeFalarCom`: nem amizade nem servidor em comum passam por cima dele.
 */

/**
 * Existe bloqueio entre os dois, em QUALQUER sentido?
 *
 * Os dois sentidos, e nao so "o alvo me bloqueou". Checar um lado so deixaria
 * quem bloqueou continuar mandando mensagem para quem bloqueou — que e
 * exatamente o comportamento que esta funcionalidade existe para impedir. Uma
 * relacao bloqueada e muda nas duas direcoes.
 *
 * Uma consulta so, com `OR`, em vez de duas: a resposta e um booleano e nao
 * interessa qual lado bloqueou.
 */
export async function haBloqueio(a: string, b: string): Promise<boolean> {
  if (a === b) return false;

  const linha = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { id: true },
  });
  return linha !== null;
}

/** Quem EU bloqueei — a lista que a tela de bloqueados mostra. */
export async function loadBlockedIds(userId: string): Promise<string[]> {
  const linhas = await prisma.block.findMany({
    where: { blockerId: userId },
    select: { blockedId: true },
  });
  return linhas.map((linha) => linha.blockedId);
}

/**
 * Os ids que devem sumir da vida de alguem, nos DOIS sentidos.
 *
 * Serve para filtrar listas — membros de servidor, resultados, presenca. Quem
 * me bloqueou entra junto com quem eu bloqueei: se a relacao e muda dos dois
 * lados, mostrar a pessoa como se nada tivesse acontecido so gera o clique que
 * vai ser recusado.
 */
export async function loadBlockedBothWays(userId: string): Promise<Set<string>> {
  const linhas = await prisma.block.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  return new Set(
    linhas.map((linha) =>
      linha.blockerId === userId ? linha.blockedId : linha.blockerId,
    ),
  );
}
