import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Confirmacao de e-mail (@aether/access/verificacao).
 *
 * Propriedades travadas:
 *  - o token vai para o e-mail em claro, mas o banco so guarda o sha256;
 *  - uso unico (`usedAt`) — e a segunda vez no link nao vira "invalido" se a
 *    conta ja esta confirmada (`jaEstava`);
 *  - expirado e usado sao motivos DISTINTOS de recusa;
 *  - `precisaVerificarEmail` respeita a flag e isenta a equipe.
 */

const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
const updateMany = vi.fn();
const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const transaction = vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
const flagLigada = vi.fn();

vi.mock("@aether/db", () => ({
  prisma: {
    $transaction: (ops: unknown[]) => transaction(ops),
    verificacaoEmail: { findUnique, create, update, updateMany },
    user: { findUnique: userFindUnique, update: userUpdate },
  },
}));

vi.mock("../../packages/access/src/flags", () => ({ flagLigada }));

const {
  criarTokenDeVerificacao,
  consumirTokenDeVerificacao,
  precisaVerificarEmail,
} = await import("../../packages/access/src/verificacao");

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
  [findUnique, create, update, updateMany, userFindUnique, userUpdate, flagLigada].forEach(
    (m) => m.mockReset(),
  );
  create.mockResolvedValue({});
  update.mockResolvedValue({});
  updateMany.mockResolvedValue({});
  userUpdate.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

describe("criarTokenDeVerificacao", () => {
  it("grava o sha256, nunca o token; invalida os anteriores", async () => {
    const token = await criarTokenDeVerificacao("u1");

    // o valor devolvido e o token em claro (vai para o link)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // o que foi para o banco e o hash
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "u1", tokenHash: sha(token) }),
    });
    // anteriores nao usados foram carimbados
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });
});

describe("consumirTokenDeVerificacao", () => {
  it("token válido: carimba usedAt e emailVerificadoEm na conta", async () => {
    findUnique.mockResolvedValue({
      id: "v1",
      userId: "u1",
      expiresAt: new Date("2026-09-07T12:00:00Z"),
      usedAt: null,
    });

    const r = await consumirTokenDeVerificacao("tok");
    expect(r).toEqual({ ok: true, userId: "u1", jaEstava: false });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { emailVerificadoEm: expect.any(Date) },
    });
  });

  it("token inexistente -> invalido", async () => {
    findUnique.mockResolvedValue(null);
    expect(await consumirTokenDeVerificacao("x")).toEqual({
      ok: false,
      motivo: "invalido",
    });
  });

  it("token expirado -> expirado (e NAO consome)", async () => {
    findUnique.mockResolvedValue({
      id: "v1",
      userId: "u1",
      expiresAt: new Date("2026-09-05T12:00:00Z"), // ontem
      usedAt: null,
    });
    expect(await consumirTokenDeVerificacao("tok")).toEqual({
      ok: false,
      motivo: "expirado",
    });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("link clicado 2x: já usado + conta já confirmada -> ok/jaEstava", async () => {
    findUnique.mockResolvedValue({
      id: "v1",
      userId: "u1",
      expiresAt: new Date("2026-09-07T12:00:00Z"),
      usedAt: new Date("2026-09-06T11:00:00Z"),
    });
    userFindUnique.mockResolvedValue({ emailVerificadoEm: new Date() });

    expect(await consumirTokenDeVerificacao("tok")).toEqual({
      ok: true,
      userId: "u1",
      jaEstava: true,
    });
  });

  it("token usado mas conta NÃO confirmada -> usado", async () => {
    findUnique.mockResolvedValue({
      id: "v1",
      userId: "u1",
      expiresAt: new Date("2026-09-07T12:00:00Z"),
      usedAt: new Date("2026-09-06T11:00:00Z"),
    });
    userFindUnique.mockResolvedValue({ emailVerificadoEm: null });

    expect(await consumirTokenDeVerificacao("tok")).toEqual({
      ok: false,
      motivo: "usado",
    });
  });
});

describe("precisaVerificarEmail", () => {
  it("conta confirmada: nunca precisa", async () => {
    expect(
      await precisaVerificarEmail({ emailVerificadoEm: new Date() }),
    ).toBe(false);
    expect(flagLigada).not.toHaveBeenCalled();
  });

  it("equipe nunca bate na parede", async () => {
    expect(
      await precisaVerificarEmail({ emailVerificadoEm: null, equipe: true }),
    ).toBe(false);
  });

  it("não confirmada + flag ligada -> precisa", async () => {
    flagLigada.mockResolvedValue(true);
    expect(await precisaVerificarEmail({ emailVerificadoEm: null })).toBe(true);
  });

  it("não confirmada + flag desligada -> não precisa (kill switch)", async () => {
    flagLigada.mockResolvedValue(false);
    expect(await precisaVerificarEmail({ emailVerificadoEm: null })).toBe(false);
  });
});
