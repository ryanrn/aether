import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Faxina dos anexos orfaos (auditoria M8).
 *
 * A regra: `messageId` nulo E mais velho que 24h. O que importa aqui e a ORDEM
 * (objeto no R2 antes da linha) e o que acontece quando o R2 falha num item —
 * a linha tem de FICAR, para a proxima passada tentar de novo.
 *
 * Banco e R2 dublados.
 */

const findMany = vi.fn();
const del = vi.fn();
const apagarObjeto = vi.fn();
const configR2 = vi.fn();

vi.mock("@aether/db", () => ({
  prisma: { attachment: { findMany, delete: del } },
}));

vi.mock("../../apps/web/src/server/storage/r2", () => ({
  apagarObjeto,
  configR2,
  autorizarUpload: vi.fn(),
  confirmarObjeto: vi.fn(),
}));

vi.mock("@aether/access", () => ({ loadPlan: vi.fn() }));

const { limparAnexosOrfaos } =
  await import("../../apps/web/src/server/services/anexos");

beforeEach(() => {
  findMany.mockReset();
  del.mockReset();
  apagarObjeto.mockReset();
  configR2.mockReset();
  configR2.mockReturnValue({ bucket: "b" });
  apagarObjeto.mockResolvedValue(true);
});

describe("limparAnexosOrfaos", () => {
  it("nao faz nada sem R2 configurado", async () => {
    configR2.mockReturnValue(null);
    const r = await limparAnexosOrfaos();
    expect(r).toMatchObject({ semArmazenamento: true, apagados: 0 });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("so pega messageId nulo e mais velho que 24h", async () => {
    findMany.mockResolvedValue([]);
    await limparAnexosOrfaos();

    const where = findMany.mock.calls[0]![0].where;
    expect(where.messageId).toBeNull();
    const corte = where.createdAt.lt as Date;
    const horas = (Date.now() - corte.getTime()) / 3_600_000;
    expect(horas).toBeGreaterThanOrEqual(23.9);
    expect(horas).toBeLessThanOrEqual(24.1);
  });

  it("apaga o objeto ANTES da linha", async () => {
    const ordem: string[] = [];
    apagarObjeto.mockImplementation(async () => {
      ordem.push("r2");
      return true;
    });
    del.mockImplementation(async () => {
      ordem.push("db");
      return {};
    });
    findMany.mockResolvedValue([{ id: "a1", chave: "anexos/u/a1.png" }]);

    const r = await limparAnexosOrfaos();
    expect(ordem).toEqual(["r2", "db"]);
    expect(apagarObjeto).toHaveBeenCalledWith("anexos/u/a1.png");
    expect(r.apagados).toBe(1);
  });

  it("R2 falha num item: conta como falha e NAO apaga a linha", async () => {
    findMany.mockResolvedValue([
      { id: "ok", chave: "k-ok" },
      { id: "ruim", chave: "k-ruim" },
    ]);
    apagarObjeto.mockImplementation(async (chave: string) => chave === "k-ok");

    const r = await limparAnexosOrfaos();

    expect(r).toMatchObject({ apagados: 1, falhas: 1 });
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith({ where: { id: "ok" } });
  });

  it("acima do teto de 200, sinaliza restam=true e nao passa do teto", async () => {
    const muitos = Array.from({ length: 201 }, (_, i) => ({
      id: `a${i}`,
      chave: `k${i}`,
    }));
    findMany.mockResolvedValue(muitos);

    const r = await limparAnexosOrfaos();
    expect(r.restam).toBe(true);
    expect(r.apagados).toBe(200);
    expect(del).toHaveBeenCalledTimes(200);
  });
});
