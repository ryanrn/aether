import { beforeEach, describe, expect, it, vi } from "vitest";

/** Resgate de missao no app web. Banco DUBLADO. */

const db = {
  missao: { findUnique: vi.fn() },
  progressoDeMissao: { updateMany: vi.fn(), findUnique: vi.fn() },
  user: { update: vi.fn() },
  movimentoDeMoedas: { create: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};
vi.mock("@aether/db", () => ({ prisma: db }));

const { resgatarMissao, MissaoIncompleta, MissaoJaResgatada, MissaoNaoEncontrada } =
  await import("../../apps/web/src/server/services/missoes");

const AGORA = new Date("2026-11-02T15:00:00Z");

beforeEach(() => {
  db.missao.findUnique.mockReset().mockResolvedValue({ ativa: true, meta: 30, recompensa: 50, periodo: "DIARIA" });
  db.progressoDeMissao.updateMany.mockReset().mockResolvedValue({ count: 1 });
  db.progressoDeMissao.findUnique.mockReset();
  db.user.update.mockReset().mockResolvedValue({ saldoMoedas: 150 });
  db.movimentoDeMoedas.create.mockReset();
});

describe("resgatarMissao", () => {
  it("marca, credita e registra no extrato com chave por periodo", async () => {
    const r = await resgatarMissao("u1", "m1", AGORA);
    expect(r).toEqual({ saldo: 150, recompensa: 50 });
    expect(db.progressoDeMissao.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", missaoId: "m1", periodo: "2026-11-02", resgatadaEm: null, valor: { gte: 30 } },
      data: { resgatadaEm: AGORA },
    });
    expect(db.user.update.mock.calls[0]![0].data).toEqual({ saldoMoedas: { increment: 50 } });
    expect(db.movimentoDeMoedas.create.mock.calls[0]![0].data).toMatchObject({
      valor: 50,
      saldoDepois: 150,
      motivo: "MISSAO",
      referencia: "m1",
      chave: "missao:u1:m1:2026-11-02",
    });
  });

  it("missao semanal usa a chave da semana", async () => {
    db.missao.findUnique.mockResolvedValue({ ativa: true, meta: 7, recompensa: 200, periodo: "SEMANAL" });
    await resgatarMissao("u1", "m1", AGORA);
    expect(db.progressoDeMissao.updateMany.mock.calls[0]![0].where.periodo).toBe("2026-W45");
  });

  it("incompleta: nao credita", async () => {
    db.progressoDeMissao.updateMany.mockResolvedValue({ count: 0 });
    db.progressoDeMissao.findUnique.mockResolvedValue({ valor: 12, resgatadaEm: null });
    await expect(resgatarMissao("u1", "m1", AGORA)).rejects.toBeInstanceOf(MissaoIncompleta);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("ja resgatada (segundo clique): nao credita de novo", async () => {
    db.progressoDeMissao.updateMany.mockResolvedValue({ count: 0 });
    db.progressoDeMissao.findUnique.mockResolvedValue({ valor: 30, resgatadaEm: AGORA });
    await expect(resgatarMissao("u1", "m1", AGORA)).rejects.toBeInstanceOf(MissaoJaResgatada);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("missao inexistente ou desligada: recusa", async () => {
    db.missao.findUnique.mockResolvedValue({ ativa: false, meta: 30, recompensa: 50, periodo: "DIARIA" });
    await expect(resgatarMissao("u1", "m1", AGORA)).rejects.toBeInstanceOf(MissaoNaoEncontrada);
    db.missao.findUnique.mockResolvedValue(null);
    await expect(resgatarMissao("u1", "m1", AGORA)).rejects.toBeInstanceOf(MissaoNaoEncontrada);
    expect(db.progressoDeMissao.updateMany).not.toHaveBeenCalled();
  });
});
