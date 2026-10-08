import type { PublicUser } from "@aether/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `entrarNaVoz`/`sairDaVoz` — extraidos de dentro do handler `voice:join`/
 * `voice:leave` para o Music Bot experimental entrar pela MESMA porta que o
 * humano usa (ver apps/realtime/src/entrar-em-voz.ts). Estes testes travam
 * que a extracao NAO mudou a regra: mesma ordem de checagem, mesmo motivo de
 * recusa, mesmo broadcast.
 */

const channelFindUnique = vi.fn();
vi.mock("@aether/db", () => ({
  prisma: { channel: { findUnique: channelFindUnique } },
}));

const flagLigada = vi.fn();
const loadMemberAccess = vi.fn();
const getChannelPermissions = vi.fn();
vi.mock("@aether/access", () => ({
  flagLigada,
  loadMemberAccess,
  getChannelPermissions,
}));

const createMediaCredentials = vi.fn();
vi.mock("../../apps/realtime/src/livekit", () => ({ createMediaCredentials }));

const talvezRemoverSalaEfemera = vi.fn();
vi.mock("../../apps/realtime/src/voz/salas-efemeras", () => ({
  talvezRemoverSalaEfemera,
}));

const countInChannel = vi.fn();
const joinVoice = vi.fn();
const leaveVoice = vi.fn();
const voiceOfServer = vi.fn();
const voiceParticipant = vi.fn();
const voiceDeparture = vi.fn((userId: string, user: unknown) => ({
  userId,
  channelId: null,
  selfMuted: false,
  selfDeafened: false,
  serverMuted: false,
  serverDeafened: false,
  streaming: false,
  camera: false,
  speaking: false,
  joinedAt: null,
  user,
}));
vi.mock("../../apps/realtime/src/state", () => ({
  countInChannel,
  joinVoice,
  leaveVoice,
  voiceDeparture,
  voiceOfServer,
  voiceParticipant,
}));

const { entrarNaVoz, sairDaVoz } = await import(
  "../../apps/realtime/src/entrar-em-voz"
);

/** `io` falso com `.to(sala).except(id).emit(...)` encadeavel, como o Socket.IO real. */
function fakeIo() {
  const emits: Array<{
    salas: string | string[];
    excluidos: string[];
    evento: string;
    payload: unknown;
  }> = [];
  function operator(salas: string | string[], excluidos: string[] = []) {
    return {
      except(id: string) {
        return operator(salas, [...excluidos, id]);
      },
      emit(evento: string, payload: unknown) {
        emits.push({ salas, excluidos, evento, payload });
      },
    };
  }
  const io = { to: (salas: string | string[]) => operator(salas) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { io: io as any, emits };
}

const USER: PublicUser = {
  id: "u_1",
  username: "ryan",
  displayName: "Ryan",
  avatarUrl: null,
  status: "ONLINE",
  kind: "HUMAN",
  plano: "FREE",
  moldura: null,
  decoracao: null,
};

beforeEach(() => {
  for (const m of [
    channelFindUnique,
    flagLigada,
    loadMemberAccess,
    getChannelPermissions,
    createMediaCredentials,
    talvezRemoverSalaEfemera,
    countInChannel,
    joinVoice,
    leaveVoice,
    voiceOfServer,
    voiceParticipant,
  ]) {
    m.mockReset();
  }
  flagLigada.mockResolvedValue(true);
  joinVoice.mockResolvedValue({ previousServerId: null });
  voiceOfServer.mockResolvedValue([]);
  createMediaCredentials.mockResolvedValue({
    url: "wss://sfu.example",
    token: "tok",
    canPublish: true,
    canShareScreen: false,
    canUseCamera: false,
    expiresAt: 123,
  });
});

describe("entrarNaVoz — recusas", () => {
  it("kill switch desligado -> recusa antes de tocar no banco", async () => {
    const { io } = fakeIo();
    flagLigada.mockResolvedValue(false);

    const r = await entrarNaVoz(io, {
      userId: "u_1",
      user: USER,
      channelId: "c_1",
      socketId: "s_1",
    });

    expect(r).toEqual({
      ok: false,
      error: "A voz esta temporariamente indisponivel.",
      codigo: "voz_desligada",
    });
    expect(channelFindUnique).not.toHaveBeenCalled();
  });

  it("canal inexistente -> nao_encontrada", async () => {
    const { io } = fakeIo();
    channelFindUnique.mockResolvedValue(null);

    const r = await entrarNaVoz(io, {
      userId: "u_1",
      user: USER,
      channelId: "c_x",
      socketId: "s_1",
    });
    expect(r).toEqual({ ok: false, error: "Canal nao encontrado", codigo: "nao_encontrada" });
  });

  it("canal de TEXTO -> nao_encontrada (nao existe pra voz)", async () => {
    const { io } = fakeIo();
    channelFindUnique.mockResolvedValue({ serverId: "s_1", type: "TEXT", userLimit: null });

    const r = await entrarNaVoz(io, {
      userId: "u_1",
      user: USER,
      channelId: "c_1",
      socketId: "s_1",
    });
    expect(r.ok).toBe(false);
    expect(loadMemberAccess).not.toHaveBeenCalled();
  });

  it("sem acesso ao servidor -> nao_encontrada", async () => {
    const { io } = fakeIo();
    channelFindUnique.mockResolvedValue({ serverId: "s_1", type: "VOICE", userLimit: null });
    loadMemberAccess.mockResolvedValue(null);

    const r = await entrarNaVoz(io, {
      userId: "u_1",
      user: USER,
      channelId: "c_1",
      socketId: "s_1",
    });
    expect(r).toEqual({ ok: false, error: "Canal nao encontrado", codigo: "nao_encontrada" });
  });

  it("sem VIEW_CHANNEL -> nao_encontrada", async () => {
    const { io } = fakeIo();
    channelFindUnique.mockResolvedValue({ serverId: "s_1", type: "VOICE", userLimit: null });
    loadMemberAccess.mockResolvedValue({ serverId: "s_1" });
    getChannelPermissions.mockResolvedValue(0n);

    const r = await entrarNaVoz(io, {
      userId: "u_1",
      user: USER,
      channelId: "c_1",
      socketId: "s_1",
    });
    expect(r.ok ? null : r.codigo).toBe("nao_encontrada");
  });

  it("ve o canal mas sem CONNECT -> sem_permissao (mensagem revela, nao esconde)", async () => {
    const { io } = fakeIo();
    channelFindUnique.mockResolvedValue({ serverId: "s_1", type: "VOICE", userLimit: null });
    loadMemberAccess.mockResolvedValue({ serverId: "s_1" });
    getChannelPermissions.mockResolvedValue(1n << 6n); // so VIEW_CHANNEL

    const r = await entrarNaVoz(io, {
      userId: "u_1",
      user: USER,
      channelId: "c_1",
      socketId: "s_1",
    });
    expect(r).toEqual({
      ok: false,
      error: "Seu cargo nao permite conectar aqui",
      codigo: "sem_permissao",
    });
  });

  it("canal cheio -> cheio (mas nao conta quem ja esta la)", async () => {
    const { io } = fakeIo();
    channelFindUnique.mockResolvedValue({ serverId: "s_1", type: "VOICE", userLimit: 2 });
    loadMemberAccess.mockResolvedValue({ serverId: "s_1" });
    getChannelPermissions.mockResolvedValue((1n << 6n) | (1n << 7n)); // VIEW+CONNECT
    voiceParticipant.mockResolvedValue(null);
    countInChannel.mockResolvedValue(2);

    const r = await entrarNaVoz(io, {
      userId: "u_1",
      user: USER,
      channelId: "c_1",
      socketId: "s_1",
    });
    expect(r).toEqual({ ok: false, error: "Canal cheio", codigo: "cheio" });
  });

  it("ja esta no canal (troca de aba/reconecta) -> nao conta contra o limite", async () => {
    const { io } = fakeIo();
    channelFindUnique.mockResolvedValue({ serverId: "s_1", type: "VOICE", userLimit: 1 });
    loadMemberAccess.mockResolvedValue({ serverId: "s_1" });
    getChannelPermissions.mockResolvedValue((1n << 6n) | (1n << 7n));
    voiceParticipant.mockResolvedValue({ channelId: "c_1" });
    countInChannel.mockResolvedValue(1); // cheio, mas e o proprio ocupante

    const r = await entrarNaVoz(io, {
      userId: "u_1",
      user: USER,
      channelId: "c_1",
      socketId: "s_1",
    });
    expect(r.ok).toBe(true);
  });
});

describe("entrarNaVoz — sucesso", () => {
  beforeEach(() => {
    channelFindUnique.mockResolvedValue({ serverId: "s_1", type: "VOICE", userLimit: null });
    loadMemberAccess.mockResolvedValue({ serverId: "s_1" });
    getChannelPermissions.mockResolvedValue((1n << 6n) | (1n << 7n));
    voiceParticipant.mockResolvedValue({ userId: "u_1", channelId: "c_1", user: USER });
  });

  it("entra, publica voice:update na sala do servidor, e devolve o media", async () => {
    const { io, emits } = fakeIo();

    const r = await entrarNaVoz(io, {
      userId: "u_1",
      user: USER,
      channelId: "c_1",
      socketId: "bot:u_1",
    });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("deveria ter dado certo");
    expect(r.media?.token).toBe("tok");
    expect(joinVoice).toHaveBeenCalledWith({
      socketId: "bot:u_1",
      userId: "u_1",
      user: USER,
      serverId: "s_1",
      channelId: "c_1",
    });
    expect(emits).toEqual([
      {
        salas: "server:s_1",
        excluidos: [],
        evento: "voice:update",
        payload: { serverId: "s_1", participant: { userId: "u_1", channelId: "c_1", user: USER } },
      },
    ]);
  });

  it("trocou de servidor: avisa o servidor anterior, EXCLUINDO o socket de quem se moveu", async () => {
    const { io, emits } = fakeIo();
    joinVoice.mockResolvedValue({ previousServerId: "s_velho" });

    await entrarNaVoz(io, {
      userId: "u_1",
      user: USER,
      channelId: "c_1",
      socketId: "s_humano",
      excluirDoAvisoAnterior: "s_humano",
    });

    const avisoAnterior = emits.find((e) => e.salas === "server:s_velho");
    expect(avisoAnterior?.excluidos).toEqual(["s_humano"]);
    expect(avisoAnterior?.payload).toMatchObject({ serverId: "s_velho" });
  });

  it("bot (sem excluirDoAvisoAnterior): avisa o servidor anterior SEM excluir ninguem", async () => {
    const { io, emits } = fakeIo();
    joinVoice.mockResolvedValue({ previousServerId: "s_velho" });

    await entrarNaVoz(io, {
      userId: "bot_1",
      user: USER,
      channelId: "c_1",
      socketId: "bot:bot_1",
    });

    const avisoAnterior = emits.find((e) => e.salas === "server:s_velho");
    expect(avisoAnterior?.excluidos).toEqual([]);
  });
});

describe("sairDaVoz", () => {
  it("nao estava em voz -> false, sem emitir nada", async () => {
    const { io, emits } = fakeIo();
    leaveVoice.mockResolvedValue(null);

    const saiu = await sairDaVoz(io, { userId: "u_1" });
    expect(saiu).toBe(false);
    expect(emits).toHaveLength(0);
  });

  it("saiu -> true, publica voice:update de partida e tenta remover sala efemera", async () => {
    const { io, emits } = fakeIo();
    leaveVoice.mockResolvedValue({ serverId: "s_1", channelId: "c_1", user: USER });

    const saiu = await sairDaVoz(io, { userId: "u_1", onlyIfSocket: "bot:u_1" });

    expect(saiu).toBe(true);
    expect(leaveVoice).toHaveBeenCalledWith("u_1", "bot:u_1");
    expect(emits[0]).toMatchObject({
      salas: "server:s_1",
      evento: "voice:update",
      payload: { serverId: "s_1", participant: { userId: "u_1", channelId: null } },
    });
    expect(talvezRemoverSalaEfemera).toHaveBeenCalledWith(io, "c_1");
  });
});
