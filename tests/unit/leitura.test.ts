import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Nao lidas persistidas (P1-3) — o lado do gateway.
 *
 * Banco, permissao de canal e `autorizarConversa` DUBLADOS. Prende-se a regra:
 * de onde a contagem comeca, que so canal visivel entra, que a leitura so
 * avanca e que recusa nao grava nada.
 */

const db = {
  serverMember: { findMany: vi.fn() },
  dmChannel: { findMany: vi.fn() },
  readState: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
  channel: { findMany: vi.fn() },
  message: { count: vi.fn(), findFirst: vi.fn() },
};

class PrismaClientKnownRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

vi.mock("@aether/db", () => ({
  prisma: db,
  Prisma: { PrismaClientKnownRequestError },
}));

const loadMemberAccess = vi.fn();
const getChannelPermissionMap = vi.fn();
vi.mock("@aether/access", () => ({ loadMemberAccess, getChannelPermissionMap }));

const autorizarConversa = vi.fn();
vi.mock("../../apps/realtime/src/enviar-mensagem", () => ({ autorizarConversa }));

const { calcularNaoLidas, marcarLeitura, inicioDaContagem } = await import(
  "../../apps/realtime/src/leitura"
);
const { combine } = await import("@aether/shared");

const emit = vi.fn();
const to = vi.fn(() => ({ emit }));
const io = { to } as unknown as Parameters<typeof marcarLeitura>[0];

const d = (s: string) => new Date(`2026-11-01T${s}:00.000Z`);

beforeEach(() => {
  for (const grupo of Object.values(db)) {
    for (const fn of Object.values(grupo)) fn.mockReset();
  }
  loadMemberAccess.mockReset();
  getChannelPermissionMap.mockReset();
  autorizarConversa.mockReset();
  emit.mockClear();
  to.mockClear();
});

describe("inicioDaContagem", () => {
  it("com leitura salva, ela manda", () => {
    expect(inicioDaContagem(d("10:00"), [d("11:00")])).toEqual(d("10:00"));
  });

  it("sem leitura, conta do acesso mais recente (entrada ou criacao do canal)", () => {
    expect(inicioDaContagem(undefined, [d("09:00"), d("11:00")])).toEqual(d("11:00"));
  });
});

describe("calcularNaoLidas", () => {
  it("conta so canal de texto visivel e DM, a partir do inicio certo", async () => {
    db.serverMember.findMany.mockResolvedValue([
      { serverId: "srv", joinedAt: d("08:00") },
    ]);
    db.dmChannel.findMany.mockResolvedValue([{ id: "dm-1", createdAt: d("07:00") }]);
    db.readState.findMany.mockResolvedValue([
      { channelId: "visivel", dmChannelId: null, lastReadAt: d("12:00") },
    ]);
    loadMemberAccess.mockResolvedValue({ serverId: "srv" });
    getChannelPermissionMap.mockResolvedValue(
      new Map([
        ["visivel", combine("VIEW_CHANNEL")],
        ["sem-linha", combine("VIEW_CHANNEL")],
        ["escondido", 0n],
      ]),
    );
    db.channel.findMany.mockResolvedValue([
      { id: "visivel", createdAt: d("06:00") },
      { id: "sem-linha", createdAt: d("09:00") },
      { id: "escondido", createdAt: d("06:00") },
    ]);
    db.message.count.mockImplementation(async ({ where }) =>
      where.channelId === "visivel" ? 3 : where.channelId === "sem-linha" ? 0 : 2,
    );

    const r = await calcularNaoLidas("eu");

    expect(r.naoLidas).toEqual({ visivel: 3, "dm-1": 2 });
    expect(r.serverDoCanal).toEqual({ visivel: "srv", "sem-linha": "srv" });

    const wheres = db.message.count.mock.calls.map((c) => c[0].where);
    // Canal invisivel nem chega a ser contado.
    expect(wheres.some((w) => w.channelId === "escondido")).toBe(false);
    const porId = (id: string) =>
      wheres.find((w) => w.channelId === id || w.dmChannelId === id)!;
    expect(porId("visivel").createdAt).toEqual({ gt: d("12:00") });
    // Sem linha: max(entrada 08:00, criacao do canal 09:00).
    expect(porId("sem-linha").createdAt).toEqual({ gt: d("09:00") });
    expect(porId("dm-1").createdAt).toEqual({ gt: d("07:00") });
    // A propria mensagem e a apagada nao contam.
    expect(porId("dm-1")).toMatchObject({ authorId: { not: "eu" }, deletedAt: null });
  });
});

describe("marcarLeitura", () => {
  beforeEach(() => {
    autorizarConversa.mockResolvedValue({
      tipo: "canal",
      channelId: "canal-1",
      serverId: "srv",
      isText: true,
    });
    db.message.findFirst.mockResolvedValue({ createdAt: d("12:00") });
  });

  it("avanca a leitura salva e avisa as suas outras abas", async () => {
    db.readState.updateMany.mockResolvedValue({ count: 1 });

    expect(await marcarLeitura(io, "eu", "canal-1", "m1")).toBe(true);

    const where = db.readState.updateMany.mock.calls[0]![0].where;
    // So avanca: a condicao `lt` impede voltar no tempo.
    expect(where).toEqual({
      userId: "eu",
      channelId: "canal-1",
      lastReadAt: { lt: d("12:00") },
    });
    expect(to).toHaveBeenCalledWith("user:eu");
    expect(emit).toHaveBeenCalledWith("read:updated", {
      conversationId: "canal-1",
      lastReadAt: d("12:00").toISOString(),
    });
  });

  it("leitura salva ja a frente: nao grava nem avisa", async () => {
    db.readState.updateMany.mockResolvedValue({ count: 0 });
    db.readState.findFirst.mockResolvedValue({ id: "rs" });

    expect(await marcarLeitura(io, "eu", "canal-1", "m1")).toBe(true);
    expect(db.readState.create).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("sem linha ainda: cria", async () => {
    db.readState.updateMany.mockResolvedValue({ count: 0 });
    db.readState.findFirst.mockResolvedValue(null);

    expect(await marcarLeitura(io, "eu", "canal-1", "m1")).toBe(true);
    expect(db.readState.create).toHaveBeenCalledWith({
      data: { userId: "eu", channelId: "canal-1", lastReadAt: d("12:00") },
    });
  });

  it("duas abas criando ao mesmo tempo: o unique barra e a leitura avanca", async () => {
    db.readState.updateMany.mockResolvedValue({ count: 0 });
    db.readState.findFirst.mockResolvedValue(null);
    db.readState.create.mockRejectedValue(new PrismaClientKnownRequestError("P2002"));

    expect(await marcarLeitura(io, "eu", "canal-1", "m1")).toBe(true);
    expect(db.readState.updateMany).toHaveBeenCalledTimes(2);
  });

  it("sem acesso a conversa: recusa e nao grava", async () => {
    autorizarConversa.mockResolvedValue(null);
    expect(await marcarLeitura(io, "eu", "canal-1", "m1")).toBe(false);
    expect(db.message.findFirst).not.toHaveBeenCalled();
    expect(db.readState.updateMany).not.toHaveBeenCalled();
  });

  it("mensagem de outra conversa ou apagada: recusa", async () => {
    db.message.findFirst.mockResolvedValue(null);
    expect(await marcarLeitura(io, "eu", "canal-1", "m-de-outro-canal")).toBe(false);
    const where = db.message.findFirst.mock.calls[0]![0].where;
    expect(where).toMatchObject({ channelId: "canal-1", deletedAt: null });
    expect(db.readState.updateMany).not.toHaveBeenCalled();
  });

  it("em DM grava pela coluna da conversa direta", async () => {
    autorizarConversa.mockResolvedValue({ tipo: "dm", dmId: "dm-1", outroId: "x" });
    db.readState.updateMany.mockResolvedValue({ count: 1 });
    await marcarLeitura(io, "eu", "dm-1", "m1");
    expect(db.message.findFirst.mock.calls[0]![0].where).toMatchObject({ dmChannelId: "dm-1" });
    expect(db.readState.updateMany.mock.calls[0]![0].where).toMatchObject({
      userId: "eu",
      dmChannelId: "dm-1",
    });
  });
});
