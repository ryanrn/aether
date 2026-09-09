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
  SlugEmUso,
  CosmeticoNaoEncontrado,
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
  ].forEach((m) => m.mockReset());
  apagarAssetCosmetico.mockResolvedValue(undefined);
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
