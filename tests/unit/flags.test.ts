import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAVES_DE_FLAG,
  FLAGS_CONHECIDAS,
  ehChaveDeFlag,
  padraoDaFlag,
} from "@aether/shared";

/**
 * Feature flags / kill switch.
 *
 * A propriedade que mais importa: `flagLigada` FALHA PARA O PADRAO, nunca para
 * "desligado". Um banco fora do ar nao pode, ele proprio, derrubar o registro
 * ou a voz — a flag e resposta deliberada a incidente, nao dependencia de
 * disponibilidade.
 *
 * Segunda: o cache de 5s nao pode esconder uma mudanca por mais que isso, nem
 * ignorar a invalidacao que `definirFlag` faz no proprio processo.
 */

const flagFindUnique = vi.fn();
const flagFindMany = vi.fn();
const flagUpsert = vi.fn();

vi.mock("@aether/db", () => ({
  prisma: {
    flag: {
      findUnique: flagFindUnique,
      findMany: flagFindMany,
      upsert: flagUpsert,
    },
  },
}));

vi.mock("@aether/shared/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { flagLigada, definirFlag, lerFlagsParaAdmin, _limparCacheDeFlags } =
  await import("../../packages/access/src/flags");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
  flagFindUnique.mockReset();
  flagFindMany.mockReset();
  flagUpsert.mockReset();
  _limparCacheDeFlags();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("registro das chaves (@aether/shared/flags)", () => {
  it("toda chave conhecida tem rotulo, descricao e padrao", () => {
    for (const chave of CHAVES_DE_FLAG) {
      const def = FLAGS_CONHECIDAS[chave];
      expect(def.rotulo.length).toBeGreaterThan(0);
      expect(def.descricao.length).toBeGreaterThan(0);
      expect(typeof def.padrao).toBe("boolean");
    }
  });

  it("os kill switches operacionais nascem ligados", () => {
    expect(padraoDaFlag("registro_aberto")).toBe(true);
    expect(padraoDaFlag("voz_habilitada")).toBe(true);
  });

  it("o que liga o beta fechado nasce desligado", () => {
    expect(padraoDaFlag("registro_exige_codigo")).toBe(false);
    expect(padraoDaFlag("upload_de_imagem")).toBe(false);
  });

  it("ehChaveDeFlag separa conhecida de qualquer string", () => {
    expect(ehChaveDeFlag("registro_aberto")).toBe(true);
    expect(ehChaveDeFlag("__proto__")).toBe(false);
    expect(ehChaveDeFlag("registro_fechado")).toBe(false);
  });
});

describe("flagLigada", () => {
  it("devolve o valor do banco quando ha linha", async () => {
    flagFindUnique.mockResolvedValue({ ligado: false });
    expect(await flagLigada("registro_aberto")).toBe(false);
  });

  it("devolve o padrao do codigo quando NAO ha linha", async () => {
    flagFindUnique.mockResolvedValue(null);
    expect(await flagLigada("registro_aberto")).toBe(true);
    expect(await flagLigada("upload_de_imagem")).toBe(false);
  });

  it("FALHA PARA O PADRAO quando a consulta lanca — nunca para desligado", async () => {
    flagFindUnique.mockRejectedValue(new Error("banco fora"));
    // registro_aberto tem padrao TRUE: um banco fora nao pode fechar o cadastro
    expect(await flagLigada("registro_aberto")).toBe(true);
    expect(await flagLigada("voz_habilitada")).toBe(true);
    // e o que tem padrao false continua false
    expect(await flagLigada("upload_de_imagem")).toBe(false);
  });

  it("cacheia: a segunda leitura dentro de 5s nao consulta de novo", async () => {
    flagFindUnique.mockResolvedValue({ ligado: false });
    await flagLigada("registro_aberto");
    await flagLigada("registro_aberto");
    await flagLigada("registro_aberto");
    expect(flagFindUnique).toHaveBeenCalledTimes(1);
  });

  it("o cache expira: depois de 5s consulta de novo e ve a mudanca", async () => {
    flagFindUnique.mockResolvedValueOnce({ ligado: true });
    expect(await flagLigada("registro_aberto")).toBe(true);

    flagFindUnique.mockResolvedValueOnce({ ligado: false });
    vi.advanceTimersByTime(5_001);
    expect(await flagLigada("registro_aberto")).toBe(false);
    expect(flagFindUnique).toHaveBeenCalledTimes(2);
  });

  it("cada chave tem seu proprio cache", async () => {
    flagFindUnique.mockImplementation(({ where }) =>
      Promise.resolve({ ligado: where.chave === "voz_habilitada" }),
    );
    expect(await flagLigada("voz_habilitada")).toBe(true);
    expect(await flagLigada("registro_aberto")).toBe(false);
    expect(flagFindUnique).toHaveBeenCalledTimes(2);
  });
});

describe("definirFlag", () => {
  it("faz upsert e invalida o cache DESTE processo na hora", async () => {
    flagFindUnique.mockResolvedValue({ ligado: true });
    expect(await flagLigada("registro_aberto")).toBe(true);

    flagUpsert.mockResolvedValue({});
    await definirFlag("registro_aberto", false, "user-1");

    // sem esperar os 5s: a proxima leitura ja ve o valor novo, sem consultar
    expect(await flagLigada("registro_aberto")).toBe(false);
    expect(flagFindUnique).toHaveBeenCalledTimes(1);
    expect(flagUpsert).toHaveBeenCalledWith({
      where: { chave: "registro_aberto" },
      create: { chave: "registro_aberto", ligado: false, atualizadoPor: "user-1" },
      update: { ligado: false, atualizadoPor: "user-1" },
    });
  });
});

describe("lerFlagsParaAdmin", () => {
  it("junta as chaves conhecidas com as linhas do banco", async () => {
    flagFindMany.mockResolvedValue([
      {
        chave: "registro_aberto",
        ligado: false,
        atualizadoPor: "ryan",
        atualizadoEm: new Date("2026-09-05T10:00:00Z"),
      },
    ]);

    const lista = await lerFlagsParaAdmin();
    expect(lista).toHaveLength(CHAVES_DE_FLAG.length);

    const registro = lista.find((f) => f.chave === "registro_aberto")!;
    expect(registro.ligado).toBe(false);
    expect(registro.personalizada).toBe(true);
    expect(registro.atualizadoPor).toBe("ryan");

    const voz = lista.find((f) => f.chave === "voz_habilitada")!;
    expect(voz.ligado).toBe(true); // padrao, sem linha
    expect(voz.personalizada).toBe(false);
    expect(voz.atualizadoPor).toBeNull();
  });
});
