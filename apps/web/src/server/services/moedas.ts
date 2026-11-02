import "server-only";

import { Prisma, prisma } from "@aether/db";
import {
  CONCESSAO_MAXIMA,
  exigeResgate,
  itemNoAr,
  planoAtende,
  type Carteira,
  type MotivoDeMoedas,
  type MovimentoPublico,
  type PlanTier,
} from "@aether/shared";

/**
 * A carteira de moedas: comprar na loja, a equipe conceder, e o extrato.
 *
 * Toda mudanca de saldo segue a MESMA forma, e nao uma variacao por caminho:
 *
 *  1. o saldo muda com um `updateMany` que JA traz a condicao no WHERE
 *     (`saldoMoedas >= preco` para debitar). Nao existe "ler o saldo, checar,
 *     gravar": duas compras ao mesmo tempo nao conseguem gastar o mesmo saldo,
 *     porque o banco avalia a condicao com a linha travada;
 *  2. na MESMA transacao, uma linha entra no extrato com o saldo resultante;
 *  3. o que a operacao entrega (o item) tambem entra na mesma transacao. Se
 *     qualquer parte falhar, nada aconteceu.
 *
 * O CHECK `User_saldo_nao_negativo` no banco e a segunda linha de defesa: um
 * caminho futuro que esquecer a condicao do passo 1 estoura em vez de deixar
 * alguem devendo.
 */

export class ItemNaoAVenda extends Error {
  override name = "ItemNaoAVenda";
}
export class JaPossui extends Error {
  override name = "JaPossui";
}
export class SaldoInsuficiente extends Error {
  override name = "SaldoInsuficiente";
  constructor(readonly saldo: number, readonly preco: number) {
    super("saldo insuficiente");
  }
}
export class ConcessaoInvalida extends Error {
  override name = "ConcessaoInvalida";
}

/** Unique violado — em compra, o item ja era da pessoa (clique duplo, outra aba). */
function ehDuplicado(erro: unknown): boolean {
  return (
    erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002"
  );
}

/**
 * Compra um cosmetico com moedas. Devolve o saldo que sobrou.
 *
 * Recusa (sem cobrar nada): item inexistente, inativo, gratis (nao se compra o
 * que ja e de todo mundo), com a colecao fora do ar, fora do plano, ja
 * possuido, ou saldo menor que o preco.
 */
export async function comprarCosmetico(
  userId: string,
  plano: PlanTier,
  cosmeticId: string,
  agora: Date = new Date(),
): Promise<{ saldo: number }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const c = await tx.cosmetic.findUnique({
        where: { id: cosmeticId },
        select: {
          ativo: true,
          tierMinimo: true,
          precoMoedas: true,
          colecao: { select: { ativa: true, inicioEm: true, fimEm: true } },
        },
      });
      if (!c || !c.ativo || c.precoMoedas == null) {
        throw new ItemNaoAVenda();
      }
      // Fora do periodo da colecao nao se vende, nem com saldo sobrando.
      if (!itemNoAr(c.colecao, agora)) throw new ItemNaoAVenda();
      // O plano continua valendo: moeda compra a peca, nao o plano que ela exige.
      if (!planoAtende(plano, c.tierMinimo)) throw new ItemNaoAVenda();

      const preco = c.precoMoedas;
      const jaTem = await tx.userCosmetic.findUnique({
        where: { userId_cosmeticId: { userId, cosmeticId } },
        select: { userId: true },
      });
      if (jaTem) throw new JaPossui();

      if (preco > 0) {
        const { count } = await tx.user.updateMany({
          where: { id: userId, saldoMoedas: { gte: preco } },
          data: { saldoMoedas: { decrement: preco } },
        });
        if (count === 0) {
          const u = await tx.user.findUnique({
            where: { id: userId },
            select: { saldoMoedas: true },
          });
          throw new SaldoInsuficiente(u?.saldoMoedas ?? 0, preco);
        }
      }

      // Unique (userId, cosmeticId): a segunda compra simultanea do MESMO item
      // estoura aqui e desfaz o debito dela inteiro.
      await tx.userCosmetic.create({
        data: { userId, cosmeticId, origem: "compra" },
      });

      const { saldoMoedas } = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { saldoMoedas: true },
      });

      // Preco zero: o item entra, mas nao ha dinheiro a registrar (o banco
      // recusa movimento de valor zero).
      if (preco > 0) {
        await tx.movimentoDeMoedas.create({
          data: {
            userId,
            valor: -preco,
            saldoDepois: saldoMoedas,
            motivo: "COMPRA",
            referencia: cosmeticId,
            chave: `compra:${userId}:${cosmeticId}`,
          },
        });
      }
      return { saldo: saldoMoedas };
    });
  } catch (erro) {
    if (ehDuplicado(erro)) throw new JaPossui();
    throw erro;
  }
}

/**
 * RESGATA um item gratis de uma colecao com prazo: grava a posse, sem mexer em
 * saldo nem extrato (nao houve dinheiro). E a posse que mantem o item da pessoa
 * depois do fim da colecao.
 *
 * So vale para o que `exigeResgate` diz, com a colecao no ar e o plano ok.
 * Resgatar de novo e recusado com `JaPossui` (a tela trata como sucesso).
 */
export async function resgatarCosmetico(
  userId: string,
  plano: PlanTier,
  cosmeticId: string,
  agora: Date = new Date(),
): Promise<void> {
  const c = await prisma.cosmetic.findUnique({
    where: { id: cosmeticId },
    select: {
      ativo: true,
      tierMinimo: true,
      precoMoedas: true,
      colecao: { select: { ativa: true, inicioEm: true, fimEm: true } },
    },
  });
  if (
    !c ||
    !c.ativo ||
    !exigeResgate(c.precoMoedas, c.colecao) ||
    !itemNoAr(c.colecao, agora) ||
    !planoAtende(plano, c.tierMinimo)
  ) {
    throw new ItemNaoAVenda();
  }
  try {
    await prisma.userCosmetic.create({
      data: { userId, cosmeticId, origem: "resgate" },
    });
  } catch (erro) {
    if (ehDuplicado(erro)) throw new JaPossui();
    throw erro;
  }
}

/**
 * A equipe da (valor positivo) ou tira (negativo) moedas de alguem. Tirar nunca
 * deixa o saldo negativo: tirar mais do que a pessoa tem e recusado inteiro.
 *
 * `chave` opcional torna a concessao idempotente (o mesmo premio de evento
 * reenviado nao credita duas vezes).
 */
export async function concederMoedas(params: {
  atorId: string;
  userId: string;
  valor: number;
  nota: string | null;
  chave?: string | null;
}): Promise<{ saldo: number }> {
  const { atorId, userId, valor, nota } = params;
  if (!Number.isInteger(valor) || valor === 0 || Math.abs(valor) > CONCESSAO_MAXIMA) {
    throw new ConcessaoInvalida();
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: valor < 0 ? { id: userId, saldoMoedas: { gte: -valor } } : { id: userId },
        data: { saldoMoedas: { increment: valor } },
      });
      if (count === 0) {
        const u = await tx.user.findUnique({
          where: { id: userId },
          select: { saldoMoedas: true },
        });
        if (!u) throw new ConcessaoInvalida();
        throw new SaldoInsuficiente(u.saldoMoedas, -valor);
      }

      const { saldoMoedas } = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { saldoMoedas: true },
      });
      await tx.movimentoDeMoedas.create({
        data: {
          userId,
          valor,
          saldoDepois: saldoMoedas,
          motivo: "CONCESSAO_EQUIPE",
          atorId,
          nota,
          chave: params.chave ?? null,
        },
      });
      return { saldo: saldoMoedas };
    });
  } catch (erro) {
    // Chave repetida: esta concessao ja tinha sido feita. Nao e erro de quem
    // mandou de novo — devolve o saldo atual, sem creditar outra vez.
    if (ehDuplicado(erro) && params.chave) {
      const u = await prisma.user.findUnique({
        where: { id: userId },
        select: { saldoMoedas: true },
      });
      return { saldo: u?.saldoMoedas ?? 0 };
    }
    throw erro;
  }
}

/** Saldo e as ultimas linhas do extrato, com o "porque" ja resolvido. */
export async function carteiraDe(userId: string, limite = 50): Promise<Carteira> {
  const [u, linhas] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { saldoMoedas: true } }),
    prisma.movimentoDeMoedas.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limite,
      select: {
        id: true,
        valor: true,
        saldoDepois: true,
        motivo: true,
        referencia: true,
        nota: true,
        createdAt: true,
      },
    }),
  ]);

  const idsDeItem = [
    ...new Set(
      linhas
        .filter((l) => l.motivo === "COMPRA" && l.referencia)
        .map((l) => l.referencia!),
    ),
  ];
  const itens = idsDeItem.length
    ? await prisma.cosmetic.findMany({
        where: { id: { in: idsDeItem } },
        select: { id: true, nome: true },
      })
    : [];
  const nomeDoItem = new Map(itens.map((i) => [i.id, i.nome]));

  const idsDeMissao = [
    ...new Set(
      linhas
        .filter((l) => l.motivo === "MISSAO" && l.referencia)
        .map((l) => l.referencia!),
    ),
  ];
  const missoes = idsDeMissao.length
    ? await prisma.missao.findMany({
        where: { id: { in: idsDeMissao } },
        select: { id: true, titulo: true },
      })
    : [];
  const nomeDaMissao = new Map(missoes.map((m) => [m.id, m.titulo]));

  const movimentos: MovimentoPublico[] = linhas.map((l) => ({
    id: l.id,
    valor: l.valor,
    saldoDepois: l.saldoDepois,
    motivo: l.motivo as MotivoDeMoedas,
    descricao:
      l.motivo === "COMPRA"
        ? (nomeDoItem.get(l.referencia ?? "") ?? "Item removido da loja")
        : l.motivo === "MISSAO"
          ? (nomeDaMissao.get(l.referencia ?? "") ?? null)
          : l.nota,
    createdAt: l.createdAt.toISOString(),
  }));

  return { saldo: u?.saldoMoedas ?? 0, movimentos };
}
