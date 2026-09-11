import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `apagarMensagem` — o segundo caminho de escrita (Etapa: excluir mensagem).
 *
 * Autorizacao DIFERENTE de `enviarMensagem`/`autorizarConversa`: aqui quem
 * pode agir e o AUTOR, ou (so em canal de servidor) quem tem MANAGE_MESSAGES.
 * DM nao tem moderador — la e so o autor, sempre.
 */

const messageFindUnique = vi.fn();
const messageUpdate = vi.fn();
const dmChannelFindUnique = vi.fn();

vi.mock("@aether/db", () => ({
  prisma: {
    message: { findUnique: messageFindUnique, update: messageUpdate },
    dmChannel: { findUnique: dmChannelFindUnique },
  },
}));

const loadMemberAccess = vi.fn();
const getChannelPermissions = vi.fn();

vi.mock("@aether/access", () => ({ loadMemberAccess, getChannelPermissions }));

const { apagarMensagem } = await import("../../apps/realtime/src/apagar-mensagem");

function fakeIo() {
  const emits: Array<{ salas: string | string[]; evento: string; payload: unknown }> = [];
  const io = {
    to(salas: string | string[]) {
      return {
        emit(evento: string, payload: unknown) {
          emits.push({ salas, evento, payload });
        },
      };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { io: io as any, emits };
}

beforeEach(() => {
  for (const m of [
    messageFindUnique,
    messageUpdate,
    dmChannelFindUnique,
    loadMemberAccess,
    getChannelPermissions,
  ]) {
    m.mockReset();
  }
  messageUpdate.mockResolvedValue({});
});

describe("apagarMensagem — canal de servidor", () => {
  it("mensagem inexistente -> nao_encontrada, sem tocar em permissao", async () => {
    const { io } = fakeIo();
    messageFindUnique.mockResolvedValue(null);

    const r = await apagarMensagem(io, { atorId: "u_1", messageId: "m_x" });
    expect(r).toEqual({
      ok: false,
      error: "Mensagem nao encontrada",
      codigo: "nao_encontrada",
    });
    expect(loadMemberAccess).not.toHaveBeenCalled();
  });

  it("ja estava apagada -> nao_encontrada (nao revela que existiu)", async () => {
    const { io } = fakeIo();
    messageFindUnique.mockResolvedValue({
      id: "m_1",
      authorId: "u_1",
      channelId: "c_1",
      dmChannelId: null,
      deletedAt: new Date(),
      channel: { serverId: "s_1" },
    });

    const r = await apagarMensagem(io, { atorId: "u_1", messageId: "m_1" });
    expect(r.ok).toBe(false);
    expect(messageUpdate).not.toHaveBeenCalled();
  });

  it("o autor apaga a propria, sem checar MANAGE_MESSAGES", async () => {
    const { io, emits } = fakeIo();
    messageFindUnique.mockResolvedValue({
      id: "m_1",
      authorId: "u_1",
      channelId: "c_1",
      dmChannelId: null,
      deletedAt: null,
      channel: { serverId: "s_1" },
    });

    const r = await apagarMensagem(io, { atorId: "u_1", messageId: "m_1" });
    expect(r).toEqual({ ok: true });
    expect(loadMemberAccess).not.toHaveBeenCalled();
    expect(messageUpdate).toHaveBeenCalledWith({
      where: { id: "m_1" },
      data: { deletedAt: expect.any(Date) },
    });
    expect(emits).toEqual([
      {
        salas: "channel:c_1",
        evento: "message:deleted",
        payload: { messageId: "m_1", conversationId: "c_1" },
      },
    ]);
  });

  it("outra pessoa, sem MANAGE_MESSAGES -> sem_permissao", async () => {
    const { io } = fakeIo();
    messageFindUnique.mockResolvedValue({
      id: "m_1",
      authorId: "u_autor",
      channelId: "c_1",
      dmChannelId: null,
      deletedAt: null,
      channel: { serverId: "s_1" },
    });
    loadMemberAccess.mockResolvedValue({ serverId: "s_1", memberId: "mem_2" });
    getChannelPermissions.mockResolvedValue(1n << 6n); // so VIEW_CHANNEL

    const r = await apagarMensagem(io, { atorId: "u_2", messageId: "m_1" });
    expect(r).toEqual({
      ok: false,
      error: "Voce nao pode apagar esta mensagem",
      codigo: "sem_permissao",
    });
    expect(messageUpdate).not.toHaveBeenCalled();
  });

  it("moderador com MANAGE_MESSAGES apaga a mensagem de outro", async () => {
    const { io, emits } = fakeIo();
    messageFindUnique.mockResolvedValue({
      id: "m_1",
      authorId: "u_autor",
      channelId: "c_1",
      dmChannelId: null,
      deletedAt: null,
      channel: { serverId: "s_1" },
    });
    loadMemberAccess.mockResolvedValue({ serverId: "s_1", memberId: "mem_mod" });
    getChannelPermissions.mockResolvedValue(1n << 11n); // MANAGE_MESSAGES

    const r = await apagarMensagem(io, { atorId: "u_mod", messageId: "m_1" });
    expect(r).toEqual({ ok: true });
    expect(emits[0]!.evento).toBe("message:deleted");
  });

  it("nao e membro do servidor -> sem_permissao (nao chama getChannelPermissions)", async () => {
    const { io } = fakeIo();
    messageFindUnique.mockResolvedValue({
      id: "m_1",
      authorId: "u_autor",
      channelId: "c_1",
      dmChannelId: null,
      deletedAt: null,
      channel: { serverId: "s_1" },
    });
    loadMemberAccess.mockResolvedValue(null);

    const r = await apagarMensagem(io, { atorId: "u_forasteiro", messageId: "m_1" });
    expect(r.ok).toBe(false);
    expect(getChannelPermissions).not.toHaveBeenCalled();
  });
});

describe("apagarMensagem — DM (sem moderador)", () => {
  it("o autor apaga a propria mensagem da DM", async () => {
    const { io, emits } = fakeIo();
    messageFindUnique.mockResolvedValue({
      id: "m_1",
      authorId: "u_1",
      channelId: null,
      dmChannelId: "dm_1",
      deletedAt: null,
      channel: null,
    });
    dmChannelFindUnique.mockResolvedValue({ userAId: "u_1", userBId: "u_2" });

    const r = await apagarMensagem(io, { atorId: "u_1", messageId: "m_1" });
    expect(r).toEqual({ ok: true });
    expect(emits).toEqual([
      {
        salas: ["user:u_1", "user:u_2"],
        evento: "message:deleted",
        payload: { messageId: "m_1", conversationId: "dm_1" },
      },
    ]);
  });

  it("a OUTRA pessoa da DM nao pode apagar (nao ha MANAGE_MESSAGES em DM)", async () => {
    const { io } = fakeIo();
    messageFindUnique.mockResolvedValue({
      id: "m_1",
      authorId: "u_1",
      channelId: null,
      dmChannelId: "dm_1",
      deletedAt: null,
      channel: null,
    });

    const r = await apagarMensagem(io, { atorId: "u_2", messageId: "m_1" });
    expect(r).toEqual({
      ok: false,
      error: "Voce nao pode apagar esta mensagem",
      codigo: "sem_permissao",
    });
    expect(loadMemberAccess).not.toHaveBeenCalled();
    expect(messageUpdate).not.toHaveBeenCalled();
  });
});
