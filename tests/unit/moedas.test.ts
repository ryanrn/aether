import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Carteira de moedas (Estagio 1 da loja). Banco DUBLADO: prende-se o que cada
 * operacao manda gravar — debito condicional no WHERE, item e extrato juntos,
 * e nada gravado quando a operacao e recusada. As garantias do proprio banco
 * (CHECK de saldo, unique de chave) sao exercitadas na migracao, no PGlite.
 */

class PrismaClientKnownRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const db = {
  cosmetic: { findUnique: vi.fn(), findMany: vi.fn() },
  userCosmetic: { findUnique: vi.fn(), create: vi.fn() },
  user: { updateMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  movimentoDeMoedas: { create: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};

vi.mock("@aether/db", () => ({
  prisma: db,
  Prisma: { PrismaClientKnownRequestError },
}));

const {
  comprarCosmetico,
  concederMoedas,
  carteiraDe,
  ItemNaoAVenda,
  JaPossui,
  SaldoInsuficiente,
  ConcessaoInvalida,
} = await import("../../apps/web/src/server/services/moedas");

const ITEM = { ativo: true, tierMinimo: "FREE", precoMoedas: 300 };

beforeEach(() => {
  for (const grupo of Object.values(db)) {
    if (typeof grupo === "function") continue;
    for (const fn of Object.values(grupo)) fn.mockReset();
  }
  db.$transaction.mockClear();
  db.cosmetic.findUnique.mockResolvedValue(ITEM);
  db.userCosmetic.findUnique.mockResolvedValue(null);
  db.user.updateMany.mockResolvedValue({ count: 1 });
  db.user.findUniqueOrThrow.mockResolvedValue({ saldoMoedas: 200 });
});

const nadaGravado = () => {
  expect(db.userCosmetic.create).not.toHaveBeenCalled();
  expect(db.movimentoDeMoedas.create).not.toHaveBeenCalled();
};

describe("comprarCosmetico", () => {
  it("debita com a condicao no WHERE, entrega o item e registra no extrato", async () => {
    const r = await comprarCosmetico("u1", "FREE", "c1");

    expect(r).toEqual({ saldo: 200 });
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", saldoMoedas: { gte: 300 } },
      data: { saldoMoedas: { decrement: 300 } },
    });
    expect(db.userCosmetic.create).toHaveBeenCalledWith({
      data: { userId: "u1", cosmeticId: "c1", origem: "compra" },
    });
    expect(db.movimentoDeMoedas.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        valor: -300,
        saldoDepois: 200,
        motivo: "COMPRA",
        referencia: "c1",
        chave: "compra:u1:c1",
      },
    });
    // Tudo numa transacao so.
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("saldo menor que o preco: recusa e diz quanto tem", async () => {
    db.user.updateMany.mockResolvedValue({ count: 0 });
    db.user.findUnique.mockResolvedValue({ saldoMoedas: 120 });

    const erro = await comprarCosmetico("u1", "FREE", "c1").catch((e) => e);
    expect(erro).toBeInstanceOf(SaldoInsuficiente);
    expect(erro).toMatchObject({ saldo: 120, preco: 300 });
    nadaGravado();
  });

  it("item que ja e seu: recusa sem cobrar", async () => {
    db.userCosmetic.findUnique.mockResolvedValue({ userId: "u1" });
    await expect(comprarCosmetico("u1", "FREE", "c1")).rejects.toBeInstanceOf(JaPossui);
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });

  it("clique duplo: a segunda compra bate no unique e vira 'ja possui'", async () => {
    db.userCosmetic.create.mockRejectedValue(new PrismaClientKnownRequestError("P2002"));
    await expect(comprarCosmetico("u1", "FREE", "c1")).rejects.toBeInstanceOf(JaPossui);
    // O debito aconteceu dentro da transacao que o erro desfaz; o extrato nem chega.
    expect(db.movimentoDeMoedas.create).not.toHaveBeenCalled();
  });

  it.each([
    ["inexistente", null],
    ["inativo", { ...ITEM, ativo: false }],
    ["gratis (nao se compra)", { ...ITEM, precoMoedas: null }],
  ])("item %s: nao esta a venda", async (_rotulo, item) => {
    db.cosmetic.findUnique.mockResolvedValue(item);
    await expect(comprarCosmetico("u1", "FREE", "c1")).rejects.toBeInstanceOf(ItemNaoAVenda);
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });

  it("item de plano: moeda nao compra o plano", async () => {
    db.cosmetic.findUnique.mockResolvedValue({ ...ITEM, tierMinimo: "PRO" });
    await expect(comprarCosmetico("u1", "FREE", "c1")).rejects.toBeInstanceOf(ItemNaoAVenda);
    db.cosmetic.findUnique.mockResolvedValue({ ...ITEM, tierMinimo: "PRO" });
    await expect(comprarCosmetico("u2", "PRO", "c1")).resolves.toEqual({ saldo: 200 });
  });

  it("preco zero: entrega sem debitar nem registrar movimento", async () => {
    db.cosmetic.findUnique.mockResolvedValue({ ...ITEM, precoMoedas: 0 });
    await comprarCosmetico("u1", "FREE", "c1");
    expect(db.user.updateMany).not.toHaveBeenCalled();
    expect(db.userCosmetic.create).toHaveBeenCalled();
    expect(db.movimentoDeMoedas.create).not.toHaveBeenCalled();
  });
});

describe("concederMoedas", () => {
  it("dar: incrementa e registra quem deu e a nota", async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ saldoMoedas: 500 });
    const r = await concederMoedas({ atorId: "eq", userId: "u1", valor: 500, nota: "evento" });
    expect(r).toEqual({ saldo: 500 });
    expect(db.user.updateMany.mock.calls[0]![0]).toEqual({
      where: { id: "u1" },
      data: { saldoMoedas: { increment: 500 } },
    });
    expect(db.movimentoDeMoedas.create.mock.calls[0]![0].data).toMatchObject({
      valor: 500,
      motivo: "CONCESSAO_EQUIPE",
      atorId: "eq",
      nota: "evento",
    });
  });

  it("tirar: exige saldo suficiente no WHERE", async () => {
    await concederMoedas({ atorId: "eq", userId: "u1", valor: -100, nota: null });
    expect(db.user.updateMany.mock.calls[0]![0].where).toEqual({
      id: "u1",
      saldoMoedas: { gte: 100 },
    });
  });

  it("tirar mais do que a pessoa tem: recusa inteiro", async () => {
    db.user.updateMany.mockResolvedValue({ count: 0 });
    db.user.findUnique.mockResolvedValue({ saldoMoedas: 40 });
    const erro = await concederMoedas({ atorId: "eq", userId: "u1", valor: -100, nota: null }).catch((e) => e);
    expect(erro).toBeInstanceOf(SaldoInsuficiente);
    expect(db.movimentoDeMoedas.create).not.toHaveBeenCalled();
  });

  it.each([0, 1.5, 100_001, -100_001])("valor %s e invalido", async (valor) => {
    await expect(
      concederMoedas({ atorId: "eq", userId: "u1", valor, nota: null }),
    ).rejects.toBeInstanceOf(ConcessaoInvalida);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("mesma chave reenviada: nao credita de novo, devolve o saldo atual", async () => {
    db.movimentoDeMoedas.create.mockRejectedValue(new PrismaClientKnownRequestError("P2002"));
    db.user.findUnique.mockResolvedValue({ saldoMoedas: 900 });
    const r = await concederMoedas({ atorId: "eq", userId: "u1", valor: 100, nota: null, chave: "evento-1:u1" });
    expect(r).toEqual({ saldo: 900 });
  });
});

describe("carteiraDe", () => {
  it("resolve o nome do item comprado e marca o que saiu da loja", async () => {
    db.user.findUnique.mockResolvedValue({ saldoMoedas: 700 });
    const agora = new Date("2026-11-02T12:00:00Z");
    db.movimentoDeMoedas.findMany.mockResolvedValue([
      { id: "m1", valor: -300, saldoDepois: 700, motivo: "COMPRA", referencia: "c1", nota: null, createdAt: agora },
      { id: "m2", valor: -100, saldoDepois: 1000, motivo: "COMPRA", referencia: "sumiu", nota: null, createdAt: agora },
      { id: "m3", valor: 1100, saldoDepois: 1100, motivo: "CONCESSAO_EQUIPE", referencia: null, nota: "evento", createdAt: agora },
    ]);
    db.cosmetic.findMany.mockResolvedValue([{ id: "c1", nome: "Aurora" }]);

    const c = await carteiraDe("u1");
    expect(c.saldo).toBe(700);
    expect(c.movimentos.map((m) => m.descricao)).toEqual([
      "Aurora",
      "Item removido da loja",
      "evento",
    ]);
  });
});
