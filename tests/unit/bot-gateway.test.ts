import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bot Gateway — `iniciarBot` (Etapa 9).
 *
 * Propriedades travadas:
 *  - app apagada / bloqueada / sem bot -> derruba o socket, sem `ready`;
 *  - com instalacao viva e acesso -> junta as salas dos canais visiveis e
 *    emite `ready` com a lista de servidores;
 *  - instalacao onde o bot perdeu acesso (kick) -> nao entra na lista nem
 *    junta sala.
 */

const applicationFindUnique = vi.fn();
const installationFindMany = vi.fn();

vi.mock("@aether/db", () => ({
  prisma: {
    application: { findUnique: applicationFindUnique },
    installation: { findMany: installationFindMany },
  },
}));

const loadMemberAccess = vi.fn();
vi.mock("@aether/access", () => ({
  loadMemberAccess,
  resolveBotToken: vi.fn(),
}));

const visibleChannelRooms = vi.fn();
vi.mock("../../apps/realtime/src/rooms", () => ({ visibleChannelRooms }));

const { iniciarBot } = await import("../../apps/realtime/src/bot-gateway");

function fakeSocket() {
  const joined: string[] = [];
  const emits: Array<{ evento: string; payload: unknown }> = [];
  let desconectado = false;
  const socket = {
    data: { applicationId: "app_1", botUserId: "u_bot", intents: ["messages"] },
    join: (sala: string) => joined.push(sala),
    emit: (evento: string, payload: unknown) => emits.push({ evento, payload }),
    disconnect: () => {
      desconectado = true;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { socket: socket as any, joined, emits, get desconectado() { return desconectado; } };
}

const APP_OK = {
  id: "app_1",
  name: "AETHER Music",
  blockedAt: null,
  bot: { id: "u_bot", username: "aether-music", displayName: "AETHER Music" },
};

beforeEach(() => {
  applicationFindUnique.mockReset();
  installationFindMany.mockReset();
  loadMemberAccess.mockReset();
  visibleChannelRooms.mockReset().mockResolvedValue([]);
});

describe("iniciarBot — recusas", () => {
  it.each([
    ["app apagada", null],
    ["app bloqueada", { ...APP_OK, blockedAt: new Date() }],
    ["sem bot habilitado", { ...APP_OK, bot: null }],
  ])("%s -> disconnect, sem ready", async (_r, app) => {
    applicationFindUnique.mockResolvedValue(app);
    const f = fakeSocket();
    await iniciarBot(f.socket);
    expect(f.desconectado).toBe(true);
    expect(f.emits).toHaveLength(0);
  });
});

describe("iniciarBot — ok", () => {
  it("junta as salas dos canais visiveis e emite ready", async () => {
    applicationFindUnique.mockResolvedValue(APP_OK);
    installationFindMany.mockResolvedValue([
      { serverId: "s_1", server: { name: "Servidor Um" } },
    ]);
    loadMemberAccess.mockResolvedValue({ serverId: "s_1" });
    visibleChannelRooms.mockResolvedValue(["channel:c_1", "channel:c_2"]);

    const f = fakeSocket();
    await iniciarBot(f.socket);

    expect(f.desconectado).toBe(false);
    expect(f.joined).toEqual(["channel:c_1", "channel:c_2"]);
    expect(f.emits).toHaveLength(1);
    expect(f.emits[0]!.evento).toBe("ready");
    expect(f.emits[0]!.payload).toMatchObject({
      application: { id: "app_1", name: "AETHER Music" },
      bot: { id: "u_bot", username: "aether-music" },
      servers: [{ id: "s_1", name: "Servidor Um" }],
    });
  });

  it("instalacao onde o bot perdeu acesso -> fora da lista, sem sala", async () => {
    applicationFindUnique.mockResolvedValue(APP_OK);
    installationFindMany.mockResolvedValue([
      { serverId: "s_1", server: { name: "Um" } },
      { serverId: "s_2", server: { name: "Dois" } },
    ]);
    loadMemberAccess.mockImplementation(async (serverId: string) =>
      serverId === "s_1" ? { serverId } : null,
    );
    visibleChannelRooms.mockResolvedValue(["channel:c_1"]);

    const f = fakeSocket();
    await iniciarBot(f.socket);

    const ready = f.emits[0]!.payload as { servers: { id: string }[] };
    expect(ready.servers).toEqual([{ id: "s_1", name: "Um" }]);
    expect(f.joined).toEqual(["channel:c_1"]); // só as de s_1
  });
});
