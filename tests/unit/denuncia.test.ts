import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Servico de denuncia.
 *
 * Propriedades travadas:
 *  - o snapshot e capturado NA HORA (o alvo pode sumir antes da revisao);
 *  - denuncia duplicada do mesmo reporter sobre o mesmo alvo aberto NAO cria
 *    linha nova — insistir nao acelera a fila;
 *  - `resolverDenuncia` so fecha o que esta ABERTA/EM_ANALISE.
 */

const denunciaFindFirst = vi.fn();
const denunciaCreate = vi.fn();
const denunciaCount = vi.fn();
const denunciaUpdateMany = vi.fn();
const messageFindUnique = vi.fn();

vi.mock("@aether/db", () => ({
  prisma: {
    denuncia: {
      findFirst: denunciaFindFirst,
      create: denunciaCreate,
      count: denunciaCount,
      updateMany: denunciaUpdateMany,
      findMany: vi.fn().mockResolvedValue([]),
    },
    message: { findUnique: messageFindUnique, findMany: vi.fn().mockResolvedValue([]) },
    user: { findUnique: vi.fn() },
    server: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("server-only", () => ({}));

const { criarDenuncia, resolverDenuncia } = await import(
  "../../apps/web/src/server/services/denuncia"
);

beforeEach(() => {
  [
    denunciaFindFirst,
    denunciaCreate,
    denunciaCount,
    denunciaUpdateMany,
    messageFindUnique,
  ].forEach((m) => m.mockReset());
  denunciaCreate.mockResolvedValue({});
});

describe("criarDenuncia", () => {
  it("captura o snapshot da mensagem (autor + texto) no momento", async () => {
    denunciaFindFirst.mockResolvedValue(null);
    messageFindUnique.mockResolvedValue({
      content: "conteúdo ofensivo aqui",
      author: { username: "trilha" },
    });

    await criarDenuncia({
      tipo: "MENSAGEM",
      alvoId: "msg1",
      motivo: "assedio",
      detalhe: null,
      reporterId: "u1",
    });

    expect(denunciaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tipo: "MENSAGEM",
        alvoId: "msg1",
        snapshot: "@trilha: conteúdo ofensivo aqui",
      }),
    });
  });

  it("duplicada (mesmo reporter, mesmo alvo, já aberta) não cria linha nova", async () => {
    denunciaFindFirst.mockResolvedValue({ id: "d-existente" });

    const r = await criarDenuncia({
      tipo: "USUARIO",
      alvoId: "u2",
      motivo: "spam",
      detalhe: null,
      reporterId: "u1",
    });

    expect(r).toEqual({ ok: true, duplicada: true });
    expect(denunciaCreate).not.toHaveBeenCalled();
  });

  it("corta o snapshot de mensagem gigante em 500 chars", async () => {
    denunciaFindFirst.mockResolvedValue(null);
    messageFindUnique.mockResolvedValue({
      content: "x".repeat(2000),
      author: { username: "a" },
    });
    await criarDenuncia({
      tipo: "MENSAGEM",
      alvoId: "m",
      motivo: "spam",
      detalhe: null,
      reporterId: "u1",
    });
    const snap = denunciaCreate.mock.calls[0]![0].data.snapshot as string;
    expect(snap.length).toBeLessThan(520);
    expect(snap.endsWith("…")).toBe(true);
  });
});

describe("resolverDenuncia", () => {
  it("fecha só o que está aberto; devolve false se nada casou", async () => {
    denunciaUpdateMany.mockResolvedValue({ count: 0 });
    expect(
      await resolverDenuncia({
        id: "d1",
        status: "RESOLVIDA",
        notaEquipe: null,
        resolvidaPor: "eq1",
      }),
    ).toBe(false);

    expect(denunciaUpdateMany).toHaveBeenCalledWith({
      where: { id: "d1", status: { in: ["ABERTA", "EM_ANALISE"] } },
      data: expect.objectContaining({ status: "RESOLVIDA", resolvidaPor: "eq1" }),
    });
  });

  it("devolve true quando fechou", async () => {
    denunciaUpdateMany.mockResolvedValue({ count: 1 });
    expect(
      await resolverDenuncia({
        id: "d1",
        status: "DESCARTADA",
        notaEquipe: "sem fundamento",
        resolvidaPor: "eq1",
      }),
    ).toBe(true);
  });
});
