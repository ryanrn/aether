import "server-only";

import { Prisma, prisma, type Cosmetic } from "@aether/db";
import {
  COSMETIC_TYPES,
  type CosmeticoNoPainel,
  type CosmeticoMeta,
  type CosmeticType,
  type PublicCosmetic,
} from "@aether/shared";
import { apagarAssetCosmetico } from "../storage/cosmeticos";

/**
 * O catalogo de cosmeticos — o que a equipe cadastra pelo painel.
 *
 * Nada aqui decide QUEM pode fazer o que: isso e o guard da action
 * (`sessaoDaEquipe`). Este arquivo so sabe mexer na tabela `Cosmetic` e, na
 * exclusao definitiva, pedir ao storage para apagar o objeto no R2.
 *
 * O binario nunca passa por aqui — as actions ja resolveram o upload e passam
 * as chaves/URLs prontas.
 */

/** Os campos do asset que a action monta com o resultado do upload. */
export interface AssetDeCosmetico {
  assetKey: string;
  assetUrl: string;
  assetMime: string;
  largura: number | null;
  altura: number | null;
  assetTrasKey: string | null;
  assetTrasUrl: string | null;
  thumbKey: string | null;
  thumbUrl: string | null;
}

export class SlugEmUso extends Error {
  override name = "SlugEmUso";
}
export class CosmeticoNaoEncontrado extends Error {
  override name = "CosmeticoNaoEncontrado";
}

function paraPainel(row: Cosmetic): CosmeticoNoPainel {
  return {
    id: row.id,
    slug: row.slug,
    nome: row.nome,
    descricao: row.descricao,
    tipo: row.tipo,
    raridade: row.raridade,
    precoMoedas: row.precoMoedas,
    tierMinimo: row.tierMinimo,
    ativo: row.ativo,
    ordem: row.ordem,
    assetUrl: row.assetUrl,
    assetTrasUrl: row.assetTrasUrl,
    thumbUrl: row.thumbUrl,
    largura: row.largura,
    altura: row.altura,
    criadoPor: row.criadoPor,
    criadoEm: row.createdAt.toISOString(),
    atualizadoEm: row.updatedAt.toISOString(),
  };
}

/**
 * O cosmetico como o APP consome. So o `ativo` chega aqui — a action publica
 * (`listarCosmeticosPublicos`) ja filtra, e este mapa nao carrega chave de
 * bucket nem nada de admin.
 */
export function paraPublico(row: Cosmetic): PublicCosmetic {
  return {
    id: row.id,
    slug: row.slug,
    nome: row.nome,
    descricao: row.descricao,
    tipo: row.tipo,
    raridade: row.raridade,
    precoMoedas: row.precoMoedas,
    tierMinimo: row.tierMinimo,
    assetUrl: row.assetUrl,
    assetTrasUrl: row.assetTrasUrl,
    thumbUrl: row.thumbUrl,
    largura: row.largura,
    altura: row.altura,
  };
}

/** A lista do painel. Sem paginacao — o catalogo e da ordem de dezenas. */
export async function listarCosmeticos(filtro?: {
  tipo?: CosmeticType;
  incluirInativos?: boolean;
}): Promise<CosmeticoNoPainel[]> {
  const rows = await prisma.cosmetic.findMany({
    where: {
      ...(filtro?.tipo ? { tipo: filtro.tipo } : {}),
      ...(filtro?.incluirInativos === false ? { ativo: true } : {}),
    },
    orderBy: [{ tipo: "asc" }, { ordem: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(paraPainel);
}

/** Quantos cosmeticos por tipo — os numeros das sub-abas do painel. */
export async function contarCosmeticosPorTipo(): Promise<
  Record<CosmeticType, number>
> {
  const grupos = await prisma.cosmetic.groupBy({
    by: ["tipo"],
    _count: { _all: true },
  });
  const base = Object.fromEntries(
    COSMETIC_TYPES.map((t) => [t, 0]),
  ) as Record<CosmeticType, number>;
  for (const g of grupos) base[g.tipo] = g._count._all;
  return base;
}

export async function cosmeticoPorId(
  id: string,
): Promise<CosmeticoNoPainel | null> {
  const row = await prisma.cosmetic.findUnique({ where: { id } });
  return row ? paraPainel(row) : null;
}

/**
 * Cria um cosmetico. Nasce SEMPRE como rascunho (`ativo: false`) — publicar e
 * um passo proprio.
 *
 * A colisao de slug e traduzida para `SlugEmUso`: o Postgres devolve `P2002` no
 * indice unico, e a action precisa saber que foi isso (e nao um erro generico)
 * para poder apagar o asset que ja subiu.
 */
export async function criarCosmetico(
  meta: CosmeticoMeta,
  asset: AssetDeCosmetico,
  criadoPor: string,
): Promise<CosmeticoNoPainel> {
  try {
    const row = await prisma.cosmetic.create({
      data: {
        slug: meta.slug,
        nome: meta.nome,
        descricao: meta.descricao,
        tipo: meta.tipo,
        raridade: meta.raridade,
        precoMoedas: meta.precoMoedas,
        tierMinimo: meta.tierMinimo,
        ordem: meta.ordem,
        ativo: false,
        assetKey: asset.assetKey,
        assetUrl: asset.assetUrl,
        assetMime: asset.assetMime,
        largura: asset.largura,
        altura: asset.altura,
        assetTrasKey: asset.assetTrasKey,
        assetTrasUrl: asset.assetTrasUrl,
        thumbKey: asset.thumbKey,
        thumbUrl: asset.thumbUrl,
        criadoPor,
      },
    });
    return paraPainel(row);
  } catch (erro) {
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === "P2002"
    ) {
      throw new SlugEmUso();
    }
    throw erro;
  }
}

/**
 * Edita os METADADOS, e opcionalmente troca o asset.
 *
 * Quando `asset` vem, o objeto ANTERIOR e apagado do R2 depois da gravacao —
 * na ordem certa, para nunca ficar com a linha apontando para o vazio.
 * `slug` NAO muda: e o identificador estavel que o app referencia.
 */
export async function editarCosmetico(
  id: string,
  meta: Omit<CosmeticoMeta, "slug" | "tipo">,
  asset: AssetDeCosmetico | null,
): Promise<CosmeticoNoPainel> {
  const atual = await prisma.cosmetic.findUnique({ where: { id } });
  if (!atual) throw new CosmeticoNaoEncontrado();

  const row = await prisma.cosmetic.update({
    where: { id },
    data: {
      nome: meta.nome,
      descricao: meta.descricao,
      raridade: meta.raridade,
      precoMoedas: meta.precoMoedas,
      tierMinimo: meta.tierMinimo,
      ordem: meta.ordem,
      ...(asset
        ? {
            assetKey: asset.assetKey,
            assetUrl: asset.assetUrl,
            assetMime: asset.assetMime,
            largura: asset.largura,
            altura: asset.altura,
            assetTrasKey: asset.assetTrasKey,
            assetTrasUrl: asset.assetTrasUrl,
            thumbKey: asset.thumbKey,
            thumbUrl: asset.thumbUrl,
          }
        : {}),
    },
  });

  if (asset && atual.assetKey !== asset.assetKey) {
    await apagarAssetCosmetico({
      assetKey: atual.assetKey,
      assetTrasKey: atual.assetTrasKey,
      thumbKey: atual.thumbKey,
    });
  }

  return paraPainel(row);
}

/** Publica ou volta para rascunho. */
export async function definirCosmeticoAtivo(
  id: string,
  ativo: boolean,
): Promise<CosmeticoNoPainel> {
  const feito = await prisma.cosmetic.updateMany({
    where: { id },
    data: { ativo },
  });
  if (feito.count === 0) throw new CosmeticoNaoEncontrado();
  const row = await prisma.cosmetic.findUniqueOrThrow({ where: { id } });
  return paraPainel(row);
}

/**
 * Exclui o cosmetico do CATALOGO. `apagarAsset` decide se o objeto tambem sai
 * do R2 — sao dois passos distintos de proposito: tirar do catalogo e
 * reversivel (recadastra), destruir a arte nao.
 *
 * A linha sai primeiro. Se o R2 falhar depois, o objeto vira orfao (faxina
 * futura), o que e melhor que uma linha que aponta para um objeto ja apagado.
 */
export async function excluirCosmetico(
  id: string,
  apagarAsset: boolean,
): Promise<void> {
  const row = await prisma.cosmetic.findUnique({ where: { id } });
  if (!row) throw new CosmeticoNaoEncontrado();

  await prisma.cosmetic.delete({ where: { id } });

  if (apagarAsset) {
    await apagarAssetCosmetico({
      assetKey: row.assetKey,
      assetTrasKey: row.assetTrasKey,
      thumbKey: row.thumbKey,
    });
  }
}

/** O catalogo PUBLICO — so o que esta ativo. Consumido pela loja/perfil. */
export async function listarCosmeticosPublicos(filtro?: {
  tipo?: CosmeticType;
}): Promise<PublicCosmetic[]> {
  const rows = await prisma.cosmetic.findMany({
    where: { ativo: true, ...(filtro?.tipo ? { tipo: filtro.tipo } : {}) },
    orderBy: [{ tipo: "asc" }, { ordem: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(paraPublico);
}
