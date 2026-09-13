import { beforeEach, describe, expect, it, vi } from "vitest";
import { cosmeticoMetaSchema } from "@aether/shared";

/**
 * O catalogo de cosmeticos (Cosmetic) — a parte que decide, com banco e R2
 * dublados.
 *
 * O que se trava aqui:
 *  - cosmetico NASCE rascunho (`ativo: false`), sempre;
 *  - slug repetido vira `SlugEmUso` (a action precisa disso para limpar o R2);
 *  - excluir do catalogo e apagar o asset sao passos SEPARADOS, e a linha sai
 *    antes do objeto;
 *  - trocar o asset num edit apaga o objeto ANTERIOR — mas so se a chave mudou;
 *  - `contarCosmeticosPorTipo` zera o tipo sem linha nenhuma;
 *  - o catalogo publico so devolve o que esta ativo.
 */

class FakeKnownError extends Error {
  code: string;
  constructor(code: string) {
    super("prisma");
    this.name = "PrismaClientKnownRequestError";
    this.code = code;
  }
}

const create = vi.fn();
const findMany = vi.fn();
const findUnique = vi.fn();
const findUniqueOrThrow = vi.fn();
const update = vi.fn();
const updateMany = vi.fn();
const del = vi.fn();
const groupBy = vi.fn();
const apagarAssetCosmetico = vi.fn();
const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const ucFindMany = vi.fn();
const ucFindUnique = vi.fn();
const ucUpsert = vi.fn();
const ucCount = vi.fn();

vi.mock("@aether/db", () => ({
  prisma: {
    cosmetic: {
      create,
      findMany,
      findUnique,
      findUniqueOrThrow,
      update,
      updateMany,
      delete: del,
      groupBy,
    },
    user: { findUnique: userFindUnique, update: userUpdate },
    userCosmetic: {
      findMany: ucFindMany,
      findUnique: ucFindUnique,
      upsert: ucUpsert,
      count: ucCount,
    },
  },
  Prisma: { PrismaClientKnownRequestError: FakeKnownError },
}));

vi.mock("../../apps/web/src/server/storage/cosmeticos", () => ({
  apagarAssetCosmetico,
}));

const {
  criarCosmetico,
  editarCosmetico,
  definirCosmeticoAtivo,
  excluirCosmetico,
  contarCosmeticosPorTipo,
  listarCosmeticosPublicos,
  catalogoParaUsuario,
  equiparCosmetico,
  concederCosmetico,
  bannerEquipado,
  SlugEmUso,
  CosmeticoNaoEncontrado,
  CosmeticoIndisponivel,
} = await import("../../apps/web/src/server/services/cosmeticos");

const META = {
  slug: "coroa-eterea",
  nome: "Coroa Eterea",
  descricao: "obsidiana e ciano",
  tipo: "DECORATION" as const,
  raridade: "mythic",
  precoMoedas: 4100,
  tierMinimo: "FREE" as const,
  ordem: 1,
};

const ASSET = {
  assetKey: "cosmetics/decorations/coroa-eterea-aa11bb22.png",
  assetUrl: "https://cdn/x/coroa-eterea-aa11bb22.png",
  assetMime: "image/png",
  largura: 512,
  altura: 512,
  assetTrasKey: "cosmetics/decorations/coroa-eterea-aa11bb22-tras.png",
  assetTrasUrl: "https://cdn/x/coroa-eterea-aa11bb22-tras.png",
  thumbKey: "cosmetics/decorations/coroa-eterea-aa11bb22-thumb.webp",
  thumbUrl: "https://cdn/x/coroa-eterea-aa11bb22-thumb.webp",
};

function linha(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    ...META,
    ...ASSET,
    ativo: false,
    criadoPor: "user-eq",
    createdAt: new Date("2026-09-09T12:00:00Z"),
    updatedAt: new Date("2026-09-09T12:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  [
    create,
    findMany,
    findUnique,
    findUniqueOrThrow,
    update,
    updateMany,
    del,
    groupBy,
    apagarAssetCosmetico,
    userFindUnique,
    userUpdate,
    ucFindMany,
    ucFindUnique,
    ucUpsert,
    ucCount,
  ].forEach((m) => m.mockReset());
  apagarAssetCosmetico.mockResolvedValue(undefined);
  ucCount.mockResolvedValue(0);
});

describe("criarCosmetico", () => {
  it("nasce SEMPRE como rascunho, mesmo que o meta diga o contrario", async () => {
    create.mockResolvedValue(linha());
    await criarCosmetico(
      { ...META, ativo: true } as never,
      ASSET,
      "user-eq",
    );
    expect(create.mock.calls[0]![0].data.ativo).toBe(false);
    expect(create.mock.calls[0]![0].data.criadoPor).toBe("user-eq");
    expect(create.mock.calls[0]![0].data.assetTrasKey).toBe(ASSET.assetTrasKey);
  });

  it("slug repetido (P2002) vira SlugEmUso", async () => {
    create.mockRejectedValue(new FakeKnownError("P2002"));
    await expect(criarCosmetico(META, ASSET, "u")).rejects.toBeInstanceOf(
      SlugEmUso,
    );
  });

  it("outro erro do banco sobe como veio", async () => {
    create.mockRejectedValue(new Error("conexao"));
    await expect(criarCosmetico(META, ASSET, "u")).rejects.toThrow("conexao");
  });
});

describe("editarCosmetico", () => {
  it("sem asset novo: nao encosta no R2", async () => {
    findUnique.mockResolvedValue(linha());
    update.mockResolvedValue(linha({ nome: "Novo" }));

    await editarCosmetico("c1", { ...META, nome: "Novo" }, null);

    expect(update).toHaveBeenCalled();
    expect(apagarAssetCosmetico).not.toHaveBeenCalled();
  });

  it("asset novo com chave diferente: apaga o ANTERIOR", async () => {
    findUnique.mockResolvedValue(linha());
    update.mockResolvedValue(linha());
    const novo = { ...ASSET, assetKey: "cosmetics/decorations/coroa-eterea-ffee.png" };

    await editarCosmetico("c1", META, novo);

    expect(apagarAssetCosmetico).toHaveBeenCalledWith({
      assetKey: ASSET.assetKey,
      assetTrasKey: ASSET.assetTrasKey,
      thumbKey: ASSET.thumbKey,
    });
  });

  it("asset novo com a MESMA chave (mesmo arquivo): nao apaga nada", async () => {
    findUnique.mockResolvedValue(linha());
    update.mockResolvedValue(linha());

    await editarCosmetico("c1", META, ASSET);

    expect(apagarAssetCosmetico).not.toHaveBeenCalled();
  });

  it("id inexistente: CosmeticoNaoEncontrado, sem update", async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      editarCosmetico("nada", META, null),
    ).rejects.toBeInstanceOf(CosmeticoNaoEncontrado);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("definirCosmeticoAtivo", () => {
  it("publica quando a linha existe", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    findUniqueOrThrow.mockResolvedValue(linha({ ativo: true }));

    const r = await definirCosmeticoAtivo("c1", true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { ativo: true },
    });
    expect(r.ativo).toBe(true);
  });

  it("id inexistente: CosmeticoNaoEncontrado", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(definirCosmeticoAtivo("x", true)).rejects.toBeInstanceOf(
      CosmeticoNaoEncontrado,
    );
  });
});

describe("excluirCosmetico", () => {
  it("apagarAsset=false: tira a linha, NAO o objeto", async () => {
    findUnique.mockResolvedValue(linha());
    del.mockResolvedValue(linha());

    await excluirCosmetico("c1", false);

    expect(del).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(apagarAssetCosmetico).not.toHaveBeenCalled();
  });

  it("devolve quantas posses (UserCosmetic) somem junto, pra quem chama poder logar", async () => {
    findUnique.mockResolvedValue(linha());
    del.mockResolvedValue(linha());
    ucCount.mockResolvedValue(3);

    const resultado = await excluirCosmetico("c1", false);

    expect(ucCount).toHaveBeenCalledWith({ where: { cosmeticId: "c1" } });
    expect(resultado.possesApagadas).toBe(3);
    expect(resultado.slug).toBe(META.slug);
  });

  it("apagarAsset=true: linha primeiro, depois o objeto", async () => {
    const ordem: string[] = [];
    findUnique.mockResolvedValue(linha());
    del.mockImplementation(async () => {
      ordem.push("db");
      return linha();
    });
    apagarAssetCosmetico.mockImplementation(async () => {
      ordem.push("r2");
    });

    await excluirCosmetico("c1", true);

    expect(ordem).toEqual(["db", "r2"]);
    expect(apagarAssetCosmetico).toHaveBeenCalledWith({
      assetKey: ASSET.assetKey,
      assetTrasKey: ASSET.assetTrasKey,
      thumbKey: ASSET.thumbKey,
    });
  });

  it("id inexistente: CosmeticoNaoEncontrado, sem delete", async () => {
    findUnique.mockResolvedValue(null);
    await expect(excluirCosmetico("x", true)).rejects.toBeInstanceOf(
      CosmeticoNaoEncontrado,
    );
    expect(del).not.toHaveBeenCalled();
  });
});

describe("contarCosmeticosPorTipo", () => {
  it("preenche zero para o tipo sem linha nenhuma", async () => {
    groupBy.mockResolvedValue([{ tipo: "DECORATION", _count: { _all: 3 } }]);
    const r = await contarCosmeticosPorTipo();
    expect(r).toEqual({ DECORATION: 3, BANNER: 0 });
  });
});

describe("listarCosmeticosPublicos", () => {
  it("filtra por ativo:true e nao vaza chave de bucket", async () => {
    findMany.mockResolvedValue([linha({ ativo: true })]);
    const r = await listarCosmeticosPublicos();

    expect(findMany.mock.calls[0]![0].where.ativo).toBe(true);
    expect(r[0]).not.toHaveProperty("assetKey");
    expect(r[0]).not.toHaveProperty("criadoPor");
    expect(r[0]!.assetUrl).toBe(ASSET.assetUrl);
    expect(r[0]!.assetTrasUrl).toBe(ASSET.assetTrasUrl);
  });
});

describe("cosmeticoMetaSchema", () => {
  const base = {
    nome: "X",
    tipo: "BANNER",
    slug: "meu-banner",
    raridade: "rare",
    tierMinimo: "PLUS",
    ordem: "2",
  };

  it("preco vazio vira null; numero passa; negativo falha", () => {
    expect(cosmeticoMetaSchema.parse({ ...base, precoMoedas: "" }).precoMoedas).toBeNull();
    expect(
      cosmeticoMetaSchema.parse({ ...base, precoMoedas: undefined }).precoMoedas,
    ).toBeNull();
    expect(cosmeticoMetaSchema.parse({ ...base, precoMoedas: "500" }).precoMoedas).toBe(500);
    expect(
      cosmeticoMetaSchema.safeParse({ ...base, precoMoedas: "-5" }).success,
    ).toBe(false);
  });

  it("normaliza o slug e recusa slug com hifen na ponta", () => {
    expect(cosmeticoMetaSchema.parse({ ...base, slug: "  Meu-Banner  " }).slug).toBe(
      "meu-banner",
    );
    expect(
      cosmeticoMetaSchema.safeParse({ ...base, slug: "-x-" }).success,
    ).toBe(false);
  });

  it("raridade e tipo fora do catalogo falham", () => {
    expect(
      cosmeticoMetaSchema.safeParse({ ...base, raridade: "uber" }).success,
    ).toBe(false);
    expect(
      cosmeticoMetaSchema.safeParse({ ...base, tipo: "EFFECT" }).success,
    ).toBe(false);
  });

  it("descricao vazia vira null", () => {
    expect(
      cosmeticoMetaSchema.parse({ ...base, precoMoedas: "", descricao: "  " }).descricao,
    ).toBeNull();
  });
});

/* ------------------------------------------------------------- equipar/possuir */

describe("catalogoParaUsuario", () => {
  it("marca bloqueado / possui / equipado por peca", async () => {
    findMany.mockResolvedValue([
      // gratis, FREE -> possui, nao bloqueado
      linha({ id: "gratis", precoMoedas: null, tierMinimo: "FREE", ativo: true }),
      // paga, FREE, SEM posse -> nao possui
      linha({ id: "paga", precoMoedas: 500, tierMinimo: "FREE", ativo: true }),
      // gratis mas PRO -> bloqueado para quem e PLUS
      linha({ id: "pro", precoMoedas: null, tierMinimo: "PRO", ativo: true }),
    ]);
    ucFindMany.mockResolvedValue([]); // nenhuma posse
    userFindUnique.mockResolvedValue({ decoracaoId: "gratis", bannerId: null });

    const cat = await catalogoParaUsuario("u1", "PLUS", "DECORATION");
    const by = Object.fromEntries(cat.map((c) => [c.id, c]));

    expect(by.gratis).toMatchObject({ possui: true, bloqueado: false, equipado: true });
    expect(by.paga).toMatchObject({ possui: false, bloqueado: false, equipado: false });
    expect(by.pro).toMatchObject({ possui: false, bloqueado: true, equipado: false });
    // where filtra por ativo:true e pelo tipo
    expect(findMany.mock.calls[0]![0].where).toMatchObject({
      ativo: true,
      tipo: "DECORATION",
    });
  });

  it("peca paga COM posse conta como possuida", async () => {
    findMany.mockResolvedValue([
      linha({ id: "paga", precoMoedas: 500, tierMinimo: "FREE", ativo: true }),
    ]);
    ucFindMany.mockResolvedValue([{ cosmeticId: "paga" }]);
    userFindUnique.mockResolvedValue({ decoracaoId: null, bannerId: null });

    const cat = await catalogoParaUsuario("u1", "FREE", "DECORATION");
    expect(cat[0]).toMatchObject({ possui: true, bloqueado: false });
  });
});

describe("equiparCosmetico", () => {
  it("null desequipa sem checar nada", async () => {
    userUpdate.mockResolvedValue({});
    const r = await equiparCosmetico("u1", "FREE", "DECORATION", null);
    expect(r).toBeNull();
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { decoracaoId: null },
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("equipa uma peca gratis que o plano cobre", async () => {
    findUnique.mockResolvedValue({
      tipo: "BANNER",
      ativo: true,
      tierMinimo: "PLUS",
      precoMoedas: null,
    });
    userUpdate.mockResolvedValue({});

    await equiparCosmetico("u1", "PRO", "BANNER", "b1");
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { bannerId: "b1" },
    });
  });

  it("recusa: inativa, tipo errado, plano de menos, ou paga sem posse", async () => {
    const casos = [
      { c: { tipo: "DECORATION", ativo: false, tierMinimo: "FREE", precoMoedas: null }, plano: "PRO" },
      { c: { tipo: "BANNER", ativo: true, tierMinimo: "FREE", precoMoedas: null }, plano: "PRO" },
      { c: { tipo: "DECORATION", ativo: true, tierMinimo: "PRO", precoMoedas: null }, plano: "PLUS" },
      { c: { tipo: "DECORATION", ativo: true, tierMinimo: "FREE", precoMoedas: 900 }, plano: "PRO" },
    ] as const;

    for (const caso of casos) {
      findUnique.mockResolvedValue(caso.c);
      ucFindUnique.mockResolvedValue(null); // sem posse
      await expect(
        equiparCosmetico("u1", caso.plano, "DECORATION", "x"),
      ).rejects.toBeInstanceOf(CosmeticoIndisponivel);
    }
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("paga COM posse: equipa", async () => {
    findUnique.mockResolvedValue({
      tipo: "DECORATION",
      ativo: true,
      tierMinimo: "FREE",
      precoMoedas: 900,
    });
    ucFindUnique.mockResolvedValue({ userId: "u1" });
    userUpdate.mockResolvedValue({});

    await equiparCosmetico("u1", "FREE", "DECORATION", "x");
    expect(userUpdate).toHaveBeenCalled();
  });
});

describe("bannerEquipado", () => {
  it("null quando inativo ou acima do plano; a URL quando vale", async () => {
    userFindUnique.mockResolvedValueOnce({
      banner: { assetUrl: "u", ativo: false, tierMinimo: "FREE" },
    });
    expect(await bannerEquipado("u1", "PRO")).toBeNull();

    userFindUnique.mockResolvedValueOnce({
      banner: { assetUrl: "u", ativo: true, tierMinimo: "PRO" },
    });
    expect(await bannerEquipado("u1", "PLUS")).toBeNull();

    userFindUnique.mockResolvedValueOnce({
      banner: { assetUrl: "https://cdn/b.png", ativo: true, tierMinimo: "PLUS" },
    });
    expect(await bannerEquipado("u1", "PRO")).toBe("https://cdn/b.png");
  });
});

describe("concederCosmetico", () => {
  it("upsert idempotente com origem 'concedido'", async () => {
    findUnique.mockResolvedValue({ id: "c1" });
    userFindUnique.mockResolvedValue({ id: "u1" });
    ucUpsert.mockResolvedValue({});

    await concederCosmetico("u1", "c1");
    expect(ucUpsert).toHaveBeenCalledWith({
      where: { userId_cosmeticId: { userId: "u1", cosmeticId: "c1" } },
      update: {},
      create: { userId: "u1", cosmeticId: "c1", origem: "concedido" },
    });
  });

  it("cosmetico ou usuario inexistente: CosmeticoNaoEncontrado", async () => {
    findUnique.mockResolvedValue(null);
    await expect(concederCosmetico("u1", "x")).rejects.toBeInstanceOf(
      CosmeticoNaoEncontrado,
    );
  });
});
