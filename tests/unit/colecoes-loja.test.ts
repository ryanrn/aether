import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Colecoes no servidor: o catalogo esconde o que saiu do ar, equipar e
 * comprar respeitam o periodo, e o resgate gratis grava a posse. Banco DUBLADO.
 */

class PrismaClientKnownRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const db = {
  cosmetic: { findUnique: vi.fn(), findMany: vi.fn() },
  userCosmetic: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  movimentoDeMoedas: { create: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};

vi.mock("@aether/db", () => ({
  prisma: db,
  Prisma: { PrismaClientKnownRequestError },
}));
vi.mock("../../apps/web/src/server/storage/cosmeticos", () => ({
  apagarAssetCosmetico: vi.fn(),
}));

const { catalogoParaUsuario, equiparCosmetico, CosmeticoIndisponivel } =
  await import("../../apps/web/src/server/services/cosmeticos");
const { comprarCosmetico, resgatarCosmetico, ItemNaoAVenda, JaPossui } =
  await import("../../apps/web/src/server/services/moedas");

const AGORA = new Date("2026-11-03T12:00:00Z");
const NO_AR = { ativa: true, inicioEm: null, fimEm: new Date("2026-11-10T00:00:00Z") };
const ENCERRADA = { ativa: true, inicioEm: null, fimEm: new Date("2026-11-01T00:00:00Z") };

function linha(over: Record<string, unknown>) {
  return {
    id: "x",
    slug: "x",
    nome: "X",
    descricao: null,
    tipo: "BANNER",
    raridade: "common",
    precoMoedas: null,
    tierMinimo: "FREE",
    ativo: true,
    ordem: 0,
    assetKey: "k",
    assetUrl: "u",
    assetMime: "image/png",
    largura: 1500,
    altura: 500,
    assetTrasKey: null,
    assetTrasUrl: null,
    thumbKey: null,
    thumbUrl: null,
    criadoPor: null,
    colecaoId: null,
    colecao: null,
    createdAt: new Date("2026-11-02T00:00:00Z"),
    updatedAt: new Date("2026-11-02T00:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  for (const grupo of Object.values(db)) {
    if (typeof grupo === "function") continue;
    for (const fn of Object.values(grupo)) fn.mockReset();
  }
  db.user.findUnique.mockResolvedValue({
    decoracaoId: null,
    bannerId: null,
    placaId: null,
    efeitoId: null,
  });
  db.userCosmetic.findMany.mockResolvedValue([]);
  db.userCosmetic.findUnique.mockResolvedValue(null);
});

describe("catalogoParaUsuario com colecoes", () => {
  it("esconde item de colecao encerrada, exceto o possuido ou o equipado", async () => {
    db.cosmetic.findMany.mockResolvedValue([
      linha({ id: "fora", colecaoId: "c1", colecao: ENCERRADA, precoMoedas: 300 }),
      linha({ id: "meu", colecaoId: "c1", colecao: ENCERRADA, precoMoedas: 300 }),
      linha({ id: "usando", colecaoId: "c1", colecao: ENCERRADA }),
      linha({ id: "solto" }),
    ]);
    db.userCosmetic.findMany.mockResolvedValue([{ cosmeticId: "meu" }]);
    db.user.findUnique.mockResolvedValue({
      decoracaoId: null,
      bannerId: "usando",
      placaId: null,
      efeitoId: null,
    });

    const cat = await catalogoParaUsuario("u1", "FREE", "BANNER", AGORA);
    expect(cat.map((c) => c.id).sort()).toEqual(["meu", "solto", "usando"]);
    const meu = cat.find((c) => c.id === "meu")!;
    expect(meu.possui).toBe(true);
    expect(meu.fimEm).toBe(ENCERRADA.fimEm.toISOString());
  });

  it("gratis de colecao com prazo: nao possui ate resgatar, e marca exigeResgate", async () => {
    db.cosmetic.findMany.mockResolvedValue([
      linha({ id: "g", colecaoId: "c1", colecao: NO_AR }),
    ]);
    const [antes] = await catalogoParaUsuario("u1", "FREE", "BANNER", AGORA);
    expect(antes).toMatchObject({ possui: false, exigeResgate: true });

    db.userCosmetic.findMany.mockResolvedValue([{ cosmeticId: "g" }]);
    const [depois] = await catalogoParaUsuario("u1", "FREE", "BANNER", AGORA);
    expect(depois).toMatchObject({ possui: true, exigeResgate: false });
  });
});

describe("equiparCosmetico com colecoes", () => {
  it("gratis com prazo sem resgate: recusa", async () => {
    db.cosmetic.findUnique.mockResolvedValue({
      tipo: "BANNER", ativo: true, tierMinimo: "FREE", precoMoedas: null, colecao: NO_AR,
    });
    await expect(
      equiparCosmetico("u1", "FREE", "BANNER", "g", AGORA),
    ).rejects.toBeInstanceOf(CosmeticoIndisponivel);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("pago de colecao encerrada, com posse: equipa", async () => {
    db.cosmetic.findUnique.mockResolvedValue({
      tipo: "BANNER", ativo: true, tierMinimo: "FREE", precoMoedas: 300, colecao: ENCERRADA,
    });
    db.userCosmetic.findUnique.mockResolvedValue({ userId: "u1" });
    db.user.update.mockResolvedValue({});
    await equiparCosmetico("u1", "FREE", "BANNER", "p", AGORA);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { bannerId: "p" },
    });
  });
});

describe("comprarCosmetico com colecoes", () => {
  it("colecao encerrada: nao vende, nao cobra", async () => {
    db.cosmetic.findUnique.mockResolvedValue({
      ativo: true, tierMinimo: "FREE", precoMoedas: 300, colecao: ENCERRADA,
    });
    await expect(
      comprarCosmetico("u1", "FREE", "p", AGORA),
    ).rejects.toBeInstanceOf(ItemNaoAVenda);
    expect(db.user.updateMany).not.toHaveBeenCalled();
    expect(db.userCosmetic.create).not.toHaveBeenCalled();
  });
});

describe("resgatarCosmetico", () => {
  it("gratis de colecao no ar: grava a posse com origem resgate, sem extrato", async () => {
    db.cosmetic.findUnique.mockResolvedValue({
      ativo: true, tierMinimo: "FREE", precoMoedas: null, colecao: NO_AR,
    });
    await resgatarCosmetico("u1", "FREE", "g", AGORA);
    expect(db.userCosmetic.create).toHaveBeenCalledWith({
      data: { userId: "u1", cosmeticId: "g", origem: "resgate" },
    });
    expect(db.movimentoDeMoedas.create).not.toHaveBeenCalled();
  });

  it("recusa: pago, sem prazo, encerrada, ou plano de menos", async () => {
    const casos = [
      { c: { ativo: true, tierMinimo: "FREE", precoMoedas: 300, colecao: NO_AR }, plano: "FREE" },
      { c: { ativo: true, tierMinimo: "FREE", precoMoedas: null, colecao: null }, plano: "FREE" },
      { c: { ativo: true, tierMinimo: "FREE", precoMoedas: null, colecao: ENCERRADA }, plano: "FREE" },
      { c: { ativo: true, tierMinimo: "PRO", precoMoedas: null, colecao: NO_AR }, plano: "PLUS" },
    ] as const;
    for (const caso of casos) {
      db.cosmetic.findUnique.mockResolvedValue(caso.c);
      await expect(
        resgatarCosmetico("u1", caso.plano, "g", AGORA),
      ).rejects.toBeInstanceOf(ItemNaoAVenda);
    }
    expect(db.userCosmetic.create).not.toHaveBeenCalled();
  });

  it("resgatar de novo: JaPossui", async () => {
    db.cosmetic.findUnique.mockResolvedValue({
      ativo: true, tierMinimo: "FREE", precoMoedas: null, colecao: NO_AR,
    });
    db.userCosmetic.create.mockRejectedValue(
      new PrismaClientKnownRequestError("P2002"),
    );
    await expect(
      resgatarCosmetico("u1", "FREE", "g", AGORA),
    ).rejects.toBeInstanceOf(JaPossui);
  });
});
