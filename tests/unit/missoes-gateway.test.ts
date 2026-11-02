import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contagem das missoes no gateway. Banco DUBLADO; o estado de voz e presenca
 * e passado por parametro, como o `index.ts` faz.
 */

class PrismaClientKnownRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const db = {
  missao: { findMany: vi.fn() },
  progressoDeMissao: { upsert: vi.fn((args) => ({ op: "upsert", args })), create: vi.fn() },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
};
vi.mock("@aether/db", () => ({ prisma: db, Prisma: { PrismaClientKnownRequestError } }));

const {
  minutoContaEmVoz,
  minutoContaJogando,
  contarMinuto,
  gravar,
  marcarDiaAtivo,
  acumuladoAtual,
  reiniciarMissoes,
} = await import("../../apps/realtime/src/missoes");

const AGORA = new Date("2026-11-02T15:00:00Z"); // segunda, meio-dia em Brasilia

const CATALOGO = [
  { id: "voz-dia", metrica: "MINUTOS_EM_VOZ", periodo: "DIARIA" },
  { id: "voz-sem", metrica: "MINUTOS_EM_VOZ", periodo: "SEMANAL" },
  { id: "jogo-dia", metrica: "MINUTOS_JOGANDO", periodo: "DIARIA" },
  { id: "presenca-dia", metrica: "DIAS_ATIVOS", periodo: "DIARIA" },
  { id: "presenca-sem", metrica: "DIAS_ATIVOS", periodo: "SEMANAL" },
];

beforeEach(() => {
  reiniciarMissoes();
  db.missao.findMany.mockReset().mockResolvedValue(CATALOGO);
  db.progressoDeMissao.upsert.mockClear();
  db.progressoDeMissao.create.mockReset().mockResolvedValue({});
  db.$transaction.mockReset().mockImplementation(async (ops: unknown[]) => ops);
});

describe("regras do minuto", () => {
  const p = { channelId: "c1", selfDeafened: false, serverDeafened: false };

  it("voz conta com mais alguem no canal e sem estar ensurdecido", () => {
    expect(minutoContaEmVoz(p, 2)).toBe(true);
    expect(minutoContaEmVoz(p, 1)).toBe(false); // sozinho
    expect(minutoContaEmVoz({ ...p, selfDeafened: true }, 3)).toBe(false);
    expect(minutoContaEmVoz({ ...p, serverDeafened: true }, 3)).toBe(false);
    expect(minutoContaEmVoz({ ...p, channelId: null }, 3)).toBe(false);
    expect(minutoContaEmVoz(null, 3)).toBe(false);
  });

  it("jogo conta com jogo detectado e sem estar invisivel", () => {
    expect(minutoContaJogando({ game: "Hades", status: "ONLINE" })).toBe(true);
    expect(minutoContaJogando({ game: "Hades", status: "DND" })).toBe(true);
    expect(minutoContaJogando({ game: "Hades", status: "OFFLINE" })).toBe(false);
    expect(minutoContaJogando({ game: null, status: "ONLINE" })).toBe(false);
  });
});

function estado(over: Record<string, unknown> = {}) {
  return {
    socketsLocais: new Map([["u1", new Set(["s-b"])]]),
    voiceSocketOf: vi.fn(async () => "s-b"),
    voiceParticipant: vi.fn(async () => ({ channelId: "c1", selfDeafened: false, serverDeafened: false })),
    countInChannel: vi.fn(async () => 2),
    socketIdsOf: vi.fn(async () => ["s-b"]),
    presenceEntryOf: vi.fn(async () => ({ game: "Hades", status: "ONLINE" })),
    ...over,
  } as unknown as Parameters<typeof contarMinuto>[0];
}

describe("contarMinuto: uma vez por pessoa", () => {
  it("soma voz e jogo de quem se qualifica", async () => {
    await contarMinuto(estado());
    expect(acumuladoAtual().get("u1")).toEqual({ voz: 1, jogo: 1 });
  });

  it("voz so conta na instancia que segura o socket de voz", async () => {
    await contarMinuto(estado({ voiceSocketOf: vi.fn(async () => "s-de-outra-instancia") }));
    expect(acumuladoAtual().get("u1")?.voz ?? 0).toBe(0);
  });

  it("jogo so conta na instancia do menor id entre os sockets da pessoa", async () => {
    // "s-a" (menor) esta em outra instancia: esta nao conta o jogo.
    await contarMinuto(estado({ socketIdsOf: vi.fn(async () => ["s-b", "s-a"]) }));
    expect(acumuladoAtual().get("u1")?.jogo ?? 0).toBe(0);
  });
});

describe("gravar", () => {
  it("leva o acumulado ao banco no periodo certo, numa transacao, e zera", async () => {
    await contarMinuto(estado());
    await contarMinuto(estado());
    await gravar(AGORA);

    expect(db.$transaction).toHaveBeenCalledOnce();
    const chamadas = db.progressoDeMissao.upsert.mock.calls.map((c) => c[0]);
    const deVozDia = chamadas.find((c) => c.where.userId_missaoId_periodo.missaoId === "voz-dia")!;
    expect(deVozDia.where.userId_missaoId_periodo).toEqual({ userId: "u1", missaoId: "voz-dia", periodo: "2026-11-02" });
    expect(deVozDia.update).toEqual({ valor: { increment: 2 } });
    expect(deVozDia.create.valor).toBe(2);
    const deVozSem = chamadas.find((c) => c.where.userId_missaoId_periodo.missaoId === "voz-sem")!;
    expect(deVozSem.where.userId_missaoId_periodo.periodo).toBe("2026-W45");
    // DIAS_ATIVOS nao e alimentado por minuto.
    expect(chamadas.some((c) => c.where.userId_missaoId_periodo.missaoId.startsWith("presenca"))).toBe(false);
    expect(acumuladoAtual().size).toBe(0);
  });

  it("se o banco falhar, o acumulado volta para a proxima tentativa", async () => {
    await contarMinuto(estado());
    db.$transaction.mockRejectedValue(new Error("banco fora"));
    await gravar(AGORA);
    expect(acumuladoAtual().get("u1")).toEqual({ voz: 1, jogo: 1 });
  });
});

describe("marcarDiaAtivo", () => {
  it("dia novo: cria a diaria e soma 1 na semanal", async () => {
    await marcarDiaAtivo("u1", AGORA);
    expect(db.progressoDeMissao.create).toHaveBeenCalledWith({
      data: { userId: "u1", missaoId: "presenca-dia", periodo: "2026-11-02", valor: 1 },
    });
    const semanal = db.progressoDeMissao.upsert.mock.calls[0]![0];
    expect(semanal.where.userId_missaoId_periodo).toEqual({ userId: "u1", missaoId: "presenca-sem", periodo: "2026-W45" });
    expect(semanal.update).toEqual({ valor: { increment: 1 } });
  });

  it("mesmo dia de novo (outra instancia ja marcou): a semanal NAO soma", async () => {
    db.progressoDeMissao.create.mockRejectedValue(new PrismaClientKnownRequestError("P2002"));
    await marcarDiaAtivo("u1", AGORA);
    expect(db.progressoDeMissao.upsert).not.toHaveBeenCalled();
  });

  it("reconectar no mesmo dia nem vai ao banco", async () => {
    await marcarDiaAtivo("u1", AGORA);
    db.progressoDeMissao.create.mockClear();
    await marcarDiaAtivo("u1", new Date("2026-11-02T20:00:00Z"));
    expect(db.progressoDeMissao.create).not.toHaveBeenCalled();
  });
});
