import "server-only";

import { Prisma, prisma, type Cosmetic } from "@aether/db";
import { log } from "@aether/shared/log";
import {
  COSMETIC_TYPES,
  imagemEfetiva,
  planoAtende,
  type CosmeticoDeLoja,
  type CosmeticoNoPainel,
  type CosmeticoMeta,
  type CosmeticType,
  type PlanTier,
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

/** O que a exclusao de fato afetou — para a action logar de verdade. */
export interface ExclusaoDeCosmetico {
  slug: string;
  nome: string;
  tipo: CosmeticType;
  /**
   * Quantas posses (`UserCosmetic`) foram apagadas em cascata junto — a
   * exclusao do catalogo NAO e so "sumir da loja": quem ja tinha o item
   * perde o registro de posse pra sempre (`onDelete: Cascade` no schema).
   */
  possesApagadas: number;
}

/**
 * Exclui o cosmetico do CATALOGO. `apagarAsset` decide se o objeto tambem sai
 * do R2 — sao dois passos distintos de proposito: tirar do catalogo e
 * reversivel (recadastra), destruir a arte nao.
 *
 * A linha sai primeiro. Se o R2 falhar depois, o objeto vira orfao (faxina
 * futura), o que e melhor que uma linha que aponta para um objeto ja apagado.
 *
 * ISTO E DESTRUTIVO ALEM DO CATALOGO: `UserCosmetic.cosmeticId` tem
 * `onDelete: Cascade` — apagar a linha do catalogo apaga junto o registro de
 * posse de QUEM JA TINHA o item (quem comprou, quem ganhou, de onde, quando).
 * Contamos quantas posses somem ANTES de apagar, so para a action poder
 * registrar isso — sem essa contagem, essa perda de dado acontecia em
 * silencio, sem log nenhum, diferente de toda outra acao destrutiva do
 * painel.
 */
export async function excluirCosmetico(
  id: string,
  apagarAsset: boolean,
): Promise<ExclusaoDeCosmetico> {
  const row = await prisma.cosmetic.findUnique({ where: { id } });
  if (!row) throw new CosmeticoNaoEncontrado();

  const possesApagadas = await prisma.userCosmetic.count({
    where: { cosmeticId: id },
  });

  await prisma.cosmetic.delete({ where: { id } });

  if (apagarAsset) {
    await apagarAssetCosmetico({
      assetKey: row.assetKey,
      assetTrasKey: row.assetTrasKey,
      thumbKey: row.thumbKey,
    });
  }

  return { slug: row.slug, nome: row.nome, tipo: row.tipo, possesApagadas };
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

/* ------------------------------------------------------------ equipar/possuir */

export class CosmeticoIndisponivel extends Error {
  override name = "CosmeticoIndisponivel";
}

/**
 * A coluna de `User` que guarda o item equipado de cada tipo. Um `Record` (e
 * nao um `if`) para que tipo novo sem coluna nao compile — antes, com dois
 * tipos, um ternario mandava qualquer tipo que nao fosse decoracao para o
 * banner.
 */
export const CAMPO_EQUIPADO = {
  DECORATION: "decoracaoId",
  BANNER: "bannerId",
  NAMEPLATE: "placaId",
  PROFILE_EFFECT: "efeitoId",
} as const satisfies Record<CosmeticType, string>;

type CampoEquipado = (typeof CAMPO_EQUIPADO)[CosmeticType];

/** O que esta pessoa tem equipado — um id por tipo. */
export async function cosmeticosEquipados(
  userId: string,
): Promise<Record<CampoEquipado, string | null>> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { decoracaoId: true, bannerId: true, placaId: true, efeitoId: true },
  });
  return {
    decoracaoId: u?.decoracaoId ?? null,
    bannerId: u?.bannerId ?? null,
    placaId: u?.placaId ?? null,
    efeitoId: u?.efeitoId ?? null,
  };
}

/**
 * O catalogo do tipo, com o estado desta pessoa em cada item.
 *
 * Ordena por raridade (raro primeiro) e depois `ordem`, como uma vitrine faz.
 * Item bloqueado por plano continua na lista — esconder o que existe atras do
 * plano nao vende, so avisa que voce nao pertence.
 */
export async function catalogoParaUsuario(
  userId: string,
  plano: PlanTier,
  tipo: CosmeticType,
): Promise<CosmeticoDeLoja[]> {
  let rows: Cosmetic[];
  let posses: { cosmeticId: string }[];
  let equip: Record<CampoEquipado, string | null>;
  try {
    [rows, posses, equip] = await Promise.all([
      prisma.cosmetic.findMany({
        where: { ativo: true, tipo },
        orderBy: [{ ordem: "asc" }, { createdAt: "asc" }],
      }),
      prisma.userCosmetic.findMany({
        where: { userId, cosmetic: { tipo } },
        select: { cosmeticId: true },
      }),
      cosmeticosEquipados(userId),
    ]);
  } catch (erro) {
    /**
     * A loja de um tipo nao pode derrubar a pagina. O caso conhecido: o enum
     * `CosmeticType` do banco de producao ainda nao tem um valor que o schema
     * ja declara (drift) — a query estoura com `22P02`. Ate a migracao rodar,
     * degrada para vazio em vez de 500.
     */
    log.warn("web.cosmeticos.catalogo", "catalogo de cosmetico falhou", {
      err: erro,
      tipo,
    });
    return [];
  }

  const temPosse = new Set(posses.map((p) => p.cosmeticId));
  const equipadoId = equip[CAMPO_EQUIPADO[tipo]];

  return rows.map((row) => {
    const bloqueado = !planoAtende(plano, row.tierMinimo);
    const possui =
      !bloqueado && (row.precoMoedas == null || temPosse.has(row.id));
    return {
      ...paraPublico(row),
      bloqueado,
      possui,
      equipado: row.id === equipadoId,
    };
  });
}

/**
 * Verifica se a pessoa PODE equipar um cosmetico agora: existe, esta ativo, e
 * do tipo certo, o plano cobre, e (se pago) ela possui.
 */
async function podeEquipar(
  userId: string,
  plano: PlanTier,
  tipo: CosmeticType,
  cosmeticId: string,
): Promise<boolean> {
  const c = await prisma.cosmetic.findUnique({
    where: { id: cosmeticId },
    select: { tipo: true, ativo: true, tierMinimo: true, precoMoedas: true },
  });
  if (!c || !c.ativo || c.tipo !== tipo) return false;
  if (!planoAtende(plano, c.tierMinimo)) return false;
  if (c.precoMoedas != null) {
    const posse = await prisma.userCosmetic.findUnique({
      where: { userId_cosmeticId: { userId, cosmeticId } },
      select: { userId: true },
    });
    if (!posse) return false;
  }
  return true;
}

/**
 * Equipa (ou, com `null`, desequipa) o item de um tipo. Devolve o id que
 * ficou valendo.
 *
 * A ESCOLHA fica guardada mesmo que o plano caia depois — a leitura
 * (`decoracaoEfetiva` / o cartao de perfil) e que decide se aparece. Igual a
 * moldura.
 */
export async function equiparCosmetico(
  userId: string,
  plano: PlanTier,
  tipo: CosmeticType,
  cosmeticId: string | null,
): Promise<string | null> {
  if (cosmeticId !== null) {
    const ok = await podeEquipar(userId, plano, tipo, cosmeticId);
    if (!ok) throw new CosmeticoIndisponivel();
  }
  await prisma.user.update({
    where: { id: userId },
    data: { [CAMPO_EQUIPADO[tipo]]: cosmeticId },
  });
  return cosmeticId;
}

/**
 * O BANNER equipado, resolvido — a URL, ou `null`. Para o cartao de perfil, que
 * busca sob demanda (banner nao viaja no `PublicUser`).
 */
export async function bannerEquipado(
  userId: string,
  plano: PlanTier,
): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      banner: { select: { assetUrl: true, ativo: true, tierMinimo: true } },
    },
  });
  return imagemEfetiva(u?.banner, plano);
}

/** O EFEITO DE PERFIL equipado, resolvido como o banner — para a tela de perfil. */
export async function efeitoEquipado(
  userId: string,
  plano: PlanTier,
): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      efeito: { select: { assetUrl: true, ativo: true, tierMinimo: true } },
    },
  });
  return imagemEfetiva(u?.efeito, plano);
}

/**
 * Concede um cosmetico a uma pessoa (a equipe, pelo painel). Idempotente —
 * conceder de novo nao duplica nem erra.
 */
export async function concederCosmetico(
  userId: string,
  cosmeticId: string,
): Promise<void> {
  const alvo = await prisma.cosmetic.findUnique({
    where: { id: cosmeticId },
    select: { id: true },
  });
  if (!alvo) throw new CosmeticoNaoEncontrado();
  const pessoa = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!pessoa) throw new CosmeticoNaoEncontrado();

  await prisma.userCosmetic.upsert({
    where: { userId_cosmeticId: { userId, cosmeticId } },
    update: {},
    create: { userId, cosmeticId, origem: "concedido" },
  });
}
