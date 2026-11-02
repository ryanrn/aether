import "server-only";

import { Prisma, prisma, type ColecaoDeCosmeticos } from "@aether/db";
import { log } from "@aether/shared/log";
import {
  colecaoNoAr,
  type ColecaoDaLoja,
  type ColecaoMeta,
  type ColecaoNoPainel,
} from "@aether/shared";

/**
 * Colecoes da loja: o cadastro (equipe) e o que a vitrine mostra.
 *
 * Quem pode mexer e o guard da action (`sessaoDaEquipe`); a regra do periodo
 * e `@aether/shared/colecoes`. Aqui so a tabela.
 */

export class ColecaoSlugEmUso extends Error {
  override name = "ColecaoSlugEmUso";
}
export class ColecaoNaoEncontrada extends Error {
  override name = "ColecaoNaoEncontrada";
}

function paraLoja(row: ColecaoDeCosmeticos): ColecaoDaLoja {
  return {
    id: row.id,
    slug: row.slug,
    nome: row.nome,
    descricao: row.descricao,
    fimEm: row.fimEm?.toISOString() ?? null,
    destaque: row.destaque,
    ordem: row.ordem,
  };
}

function paraPainel(
  row: ColecaoDeCosmeticos & { _count: { itens: number } },
): ColecaoNoPainel {
  return {
    ...paraLoja(row),
    inicioEm: row.inicioEm?.toISOString() ?? null,
    ativa: row.ativa,
    itens: row._count.itens,
  };
}

const ORDEM = [{ ordem: "asc" }, { createdAt: "asc" }] as const;

/**
 * As colecoes NO AR agora, na ordem da vitrine (`ordem`). A tela escolhe a
 * de destaque: a primeira marcada que tenha item visivel.
 */
export async function colecoesDaLoja(
  agora: Date = new Date(),
): Promise<ColecaoDaLoja[]> {
  try {
    const rows = await prisma.colecaoDeCosmeticos.findMany({
      where: { ativa: true },
      orderBy: [...ORDEM],
    });
    return rows.filter((r) => colecaoNoAr(r, agora)).map(paraLoja);
  } catch (erro) {
    // A vitrine sem colecoes ainda e uma loja; nao derruba a pagina.
    log.warn("web.colecoes.loja", "listar colecoes da loja falhou", { err: erro });
    return [];
  }
}

/** Todas, para o painel — inclusive rascunho e fora do periodo. */
export async function listarColecoes(): Promise<ColecaoNoPainel[]> {
  const rows = await prisma.colecaoDeCosmeticos.findMany({
    orderBy: [...ORDEM],
    include: { _count: { select: { itens: true } } },
  });
  return rows.map(paraPainel);
}

function dados(meta: ColecaoMeta) {
  return {
    nome: meta.nome,
    descricao: meta.descricao,
    inicioEm: meta.inicioEm,
    fimEm: meta.fimEm,
    destaque: meta.destaque,
    ativa: meta.ativa,
    ordem: meta.ordem,
  };
}

function ehDuplicado(erro: unknown): boolean {
  return (
    erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002"
  );
}

export async function criarColecao(
  meta: ColecaoMeta,
  criadoPor: string,
): Promise<ColecaoNoPainel> {
  try {
    const row = await prisma.colecaoDeCosmeticos.create({
      data: { slug: meta.slug, ...dados(meta), criadoPor },
      include: { _count: { select: { itens: true } } },
    });
    return paraPainel(row);
  } catch (erro) {
    if (ehDuplicado(erro)) throw new ColecaoSlugEmUso();
    throw erro;
  }
}

/** Edita tudo menos o `slug`, que e o identificador estavel. */
export async function editarColecao(
  id: string,
  meta: ColecaoMeta,
): Promise<ColecaoNoPainel> {
  const existe = await prisma.colecaoDeCosmeticos.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existe) throw new ColecaoNaoEncontrada();
  const row = await prisma.colecaoDeCosmeticos.update({
    where: { id },
    data: dados(meta),
    include: { _count: { select: { itens: true } } },
  });
  return paraPainel(row);
}

/**
 * Apaga a colecao. Os itens ficam, sem colecao (FK SET NULL) — e voltam a
 * valer sem prazo. Quem quer tirar os itens da loja desativa a colecao em vez
 * de apagar.
 */
export async function excluirColecao(id: string): Promise<void> {
  const { count } = await prisma.colecaoDeCosmeticos.deleteMany({
    where: { id },
  });
  if (count === 0) throw new ColecaoNaoEncontrada();
}
