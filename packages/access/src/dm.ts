import { prisma } from "@aether/db";
import { areFriends } from "./friends";
import { haBloqueio } from "./block";

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

/** Por que a conversa e permitida — a UI usa para explicar, nao para decidir. */
export type MotivoDm = "amizade" | "servidor";

/**
 * `ator` pode falar com `alvo`?
 *
 * Um portao e duas portas, nesta ordem:
 *
 *  0. BLOQUEIO, em qualquer sentido. Fecha tudo: nem amizade nem servidor em
 *     comum passam por cima. Vem PRIMEIRO de proposito — se viesse depois,
 *     bastaria a amizade sobreviver ao bloqueio para o bloqueio nao valer.
 *  1. AMIZADE. Passa por cima da configuracao — quem ja e seu amigo nao
 *     depende de `allowServerDms`.
 *  2. SERVIDOR EM COMUM, se `alvo` aceitar esse caminho (`allowServerDms`).
 *
 * A REGRA E ASSIMETRICA de proposito, e vale entender por que: quem checa e
 * quem AGE, e a chave consultada e a de quem RECEBE. Entao, se B desliga a
 * opcao, A deixa de alcancar B — que e exatamente o objetivo. B, por sua vez,
 * continua podendo ler e responder a propria conversa, porque a chave dele
 * governa o que CHEGA nele, nao o que ele quer dizer.
 *
 * Devolve `null` quando nao pode. Nunca devolve motivo diferente para "nao
 * existe" e "nao aceita": quem chama transforma isso em uma mensagem so.
 */
export async function podeFalarCom(
  ator: string,
  alvo: string,
): Promise<MotivoDm | null> {
  if (ator === alvo) return null;

  // Antes de tudo. Ver o comentario acima sobre a ordem.
  if (await haBloqueio(ator, alvo)) return null;

  if (await areFriends(ator, alvo)) return "amizade";

  const alvoAceita = await prisma.user.findUnique({
    where: { id: alvo },
    select: { allowServerDms: true },
  });
  if (!alvoAceita?.allowServerDms) return null;

  return (await dividemServidor(ator, alvo)) ? "servidor" : null;
}

/**
 * Os dois sao membros de algum servidor em comum?
 *
 * Uma consulta so, com `IN`, em vez de carregar as duas listas e cruzar em
 * memoria: quem tem muitos servidores carregaria muitas linhas para descobrir
 * um `true`.
 */
async function dividemServidor(a: string, b: string): Promise<boolean> {
  const encontrado = await prisma.serverMember.findFirst({
    where: {
      userId: b,
      serverId: {
        in: (
          await prisma.serverMember.findMany({
            where: { userId: a },
            select: { serverId: true },
          })
        ).map((m) => m.serverId),
      },
    },
    select: { id: true },
  });
  return encontrado !== null;
}

/**
 * Voce pode ler e escrever nesta conversa?
 *
 * Devolve `null` para os dois casos que precisam ser indistinguiveis: a
 * conversa nao existe, ou existe e nao e sua. Quem chama responde 404 nos
 * dois, como no resto do sistema — dizer "essa conversa existe, mas nao e
 * sua" ja contaria que duas pessoas especificas se falam.
 *
 * A PERMISSAO E RECHECADA A CADA CHAMADA, e nao so quando a conversa foi
 * aberta. Sem bloqueio no produto, desfazer a amizade — ou desligar
 * `allowServerDms` — e a UNICA forma de alguem parar de receber mensagem de
 * outra pessoa; se a checagem valesse so na abertura, o canal continuaria
 * aberto para sempre depois de aceito uma vez. A conversa nao e apagada:
 * refazendo a amizade (ou religando a chave), o historico volta.
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

  if ((await podeFalarCom(userId, outroId)) === null) return null;

  return { dmId: dm.id, outroId };
}

/**
 * As conversas de alguem, com quem esta do outro lado.
 *
 * Passa cada uma pela MESMA porta que `loadDmAccess` — nao por um filtro
 * proprio. A primeira versao filtrava so por amizade, e quando o caminho
 * "servidor em comum" surgiu, ela teria escondido da lista conversas que a
 * pessoa ainda consegue abrir pela URL. Lista que discorda do acesso e a
 * forma mais silenciosa de a regra divergir.
 *
 * Sao N consultas, uma por conversa. Na escala deste projeto — um grupo de
 * amigos — sao dezenas; se um dia forem milhares, o jeito e resolver as duas
 * portas em lote, nao afrouxar a checagem.
 */
export async function loadDmList(
  userId: string,
): Promise<Array<{ dmId: string; outroId: string; motivo: MotivoDm }>> {
  const linhas = await prisma.dmChannel.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true },
  });

  const saida: Array<{ dmId: string; outroId: string; motivo: MotivoDm }> = [];
  for (const linha of linhas) {
    const outroId = linha.userAId === userId ? linha.userBId : linha.userAId;
    const motivo = await podeFalarCom(userId, outroId);
    if (motivo) saida.push({ dmId: linha.id, outroId, motivo });
  }
  return saida;
}
