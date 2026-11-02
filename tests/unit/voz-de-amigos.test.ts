import type { PublicUser, VoiceParticipant } from "@aether/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A call dos amigos na tela Amigos (`apps/realtime/src/voz/voz-de-amigos.ts`).
 *
 * O que estes testes travam e a PRIVACIDADE: a visao e calculada por quem ve,
 * e quem nao ve o canal recebe `null` — nunca "em canal privado". E o custo:
 * fala/mudo nao mudam a assinatura, entao nao geram nada para amigos.
 */

const channelFindUnique = vi.fn();
vi.mock("@aether/db", () => ({
  prisma: { channel: { findUnique: channelFindUnique } },
}));

const loadMemberAccess = vi.fn();
const getChannelPermissions = vi.fn();
vi.mock("@aether/access", () => ({ loadMemberAccess, getChannelPermissions }));

const friendsOf = vi.fn();
const isConnected = vi.fn();
const statusOf = vi.fn();
const voiceLocation = vi.fn();
const voiceOfServer = vi.fn();
vi.mock("../../apps/realtime/src/state", () => ({
  friendsOf,
  isConnected,
  statusOf,
  voiceLocation,
  voiceOfServer,
}));

const { marcarVozAlterada, vozDosAmigos, reavaliarVozDe } = await import(
  "../../apps/realtime/src/voz/voz-de-amigos"
);
const { Permission } = await import("@aether/shared");

function fakeIo() {
  const emits: Array<{ sala: string; evento: string; payload: any }> = [];
  const io = {
    to: (sala: string) => ({
      emit: (evento: string, payload: unknown) => emits.push({ sala, evento, payload }),
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { io: io as any, emits };
}

function usuario(id: string): PublicUser {
  return {
    id,
    username: id,
    displayName: id.toUpperCase(),
    avatarUrl: null,
    status: "ONLINE",
    kind: "HUMAN",
  } as PublicUser;
}

function ocupante(id: string, channelId: string, extra: Partial<VoiceParticipant> = {}): VoiceParticipant {
  return {
    userId: id,
    channelId,
    selfMuted: false,
    selfDeafened: false,
    serverMuted: false,
    serverDeafened: false,
    streaming: false,
    camera: false,
    speaking: false,
    joinedAt: `2026-11-02T12:00:0${id.length}.000Z`,
    user: usuario(id),
    ...extra,
  };
}

const VER = Permission.VIEW_CHANNEL;

/** Estado: "mau" esta no canal c1 do servidor s1 com "fabin". */
let ocupantes: VoiceParticipant[];
/** quem pode ver c1 */
let podemVer: Set<string>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  ocupantes = [ocupante("mau", "c1"), ocupante("fabin", "c1")];
  podemVer = new Set(["eu"]);

  channelFindUnique.mockResolvedValue({
    name: "Squad 1",
    userLimit: 4,
    type: "VOICE",
    server: { id: "s1", name: "Comunidade", iconUrl: null },
  });
  voiceOfServer.mockImplementation(async () => ocupantes);
  voiceLocation.mockImplementation(async (id: string) => {
    const p = ocupantes.find((o) => o.userId === id);
    return p ? { serverId: "s1", channelId: p.channelId } : null;
  });
  statusOf.mockResolvedValue("ONLINE");
  friendsOf.mockImplementation(async (id: string) =>
    id === "mau" ? ["eu", "estranho"] : id === "eu" ? ["mau"] : [],
  );
  isConnected.mockResolvedValue(true);
  loadMemberAccess.mockImplementation(async (_s: string, viewer: string) =>
    podemVer.has(viewer) ? { serverId: "s1", userId: viewer } : null,
  );
  getChannelPermissions.mockResolvedValue(VER);
});

afterEach(() => {
  vi.useRealTimers();
});

async function rodar() {
  await vi.advanceTimersByTimeAsync(500);
}

describe("voz dos amigos", () => {
  it("amigo que ve o canal recebe a call; quem nao e membro recebe null", async () => {
    const { io, emits } = fakeIo();
    marcarVozAlterada(io, "s1", ["mau"]);
    await rodar();

    const paraEu = emits.find((e) => e.sala === "user:eu" && e.payload.userId === "mau");
    const paraEstranho = emits.find((e) => e.sala === "user:estranho" && e.payload.userId === "mau");
    expect(paraEu?.evento).toBe("friend:voice");
    expect(paraEu?.payload.voz).toMatchObject({
      channelName: "Squad 1",
      serverName: "Comunidade",
      total: 2,
      userLimit: 4,
    });
    expect(paraEu?.payload.voz.participantes.map((u: PublicUser) => u.id)).toEqual(["mau", "fabin"]);
    // Nao revela nada: nem nome de canal, nem "privado".
    expect(paraEstranho?.payload.voz).toBeNull();
  });

  it("falar ou mutar nao gera evento para amigos (assinatura igual)", async () => {
    const { io, emits } = fakeIo();
    ocupantes = [ocupante("mau", "c2"), ocupante("fabin", "c2")];
    marcarVozAlterada(io, "s1", ["mau"]);
    await rodar();
    const antes = emits.length;

    ocupantes = [
      ocupante("mau", "c2", { speaking: true, selfMuted: true }),
      ocupante("fabin", "c2"),
    ];
    marcarVozAlterada(io, "s1", ["mau"]);
    await rodar();
    expect(emits.length).toBe(antes);
  });

  it("debounce: varias marcas na mesma janela viram um processamento", async () => {
    const { io } = fakeIo();
    ocupantes = [ocupante("mau", "c3")];
    marcarVozAlterada(io, "s1", ["mau"]);
    marcarVozAlterada(io, "s1", ["mau"]);
    marcarVozAlterada(io, "s1", []);
    await rodar();
    expect(voiceOfServer).toHaveBeenCalledTimes(1);
  });

  it("saiu da call: amigos recebem null (pela dica, ja que nao esta mais no estado)", async () => {
    const { io, emits } = fakeIo();
    ocupantes = [ocupante("mau", "c4")];
    marcarVozAlterada(io, "s1", ["mau"]);
    await rodar();

    ocupantes = [];
    marcarVozAlterada(io, "s1", ["mau"]);
    await rodar();
    const ultimo = emits.filter((e) => e.sala === "user:eu").at(-1);
    expect(ultimo?.payload).toEqual({ userId: "mau", voz: null });
  });

  it("trocou de servidor: o servidor antigo nao anuncia null por cima da call nova", async () => {
    const { io, emits } = fakeIo();
    ocupantes = [];
    voiceLocation.mockResolvedValue({ serverId: "s2", channelId: "c9" });
    marcarVozAlterada(io, "s1", ["mau"]);
    await rodar();
    expect(emits).toHaveLength(0);
  });

  it("invisivel: amigos recebem null", async () => {
    const { io, emits } = fakeIo();
    ocupantes = [ocupante("mau", "c5")];
    marcarVozAlterada(io, "s1", ["mau"]);
    await rodar();

    statusOf.mockResolvedValue("OFFLINE");
    await reavaliarVozDe(io, "mau");
    await rodar();
    const ultimo = emits.filter((e) => e.sala === "user:eu").at(-1);
    expect(ultimo?.payload.voz).toBeNull();
  });

  it("amigo desconectado nao custa consulta de acesso", async () => {
    const { io } = fakeIo();
    ocupantes = [ocupante("mau", "c6")];
    isConnected.mockImplementation(async (id: string) => id === "eu");
    marcarVozAlterada(io, "s1", ["mau"]);
    await rodar();
    expect(loadMemberAccess.mock.calls.map((c) => c[1])).not.toContain("estranho");
  });

  it("foto (friend:voice-sync): so as calls que quem pede pode ver", async () => {
    ocupantes = [ocupante("mau", "c7")];
    expect(await vozDosAmigos("eu")).toEqual([
      expect.objectContaining({ userId: "mau", voz: expect.objectContaining({ channelId: "c7" }) }),
    ]);
    podemVer = new Set();
    getChannelPermissions.mockResolvedValue(null);
    ocupantes = [ocupante("mau", "c8")];
    expect(await vozDosAmigos("eu")).toEqual([]);
  });
});
