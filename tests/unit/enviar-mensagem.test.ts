import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `enviarMensagem` — o unico caminho de escrita de mensagem (Etapa 5).
 *
 * A logica foi extraida do handler `message:send` para a REST de bots e o
 * webhook passarem pela mesma porta. Estes casos travam que o comportamento e
 * o mesmo do handler antigo: silenciamento, validacao, autorizacao,
 * canal-de-voz, transacao com anexos, e o evento certo (canal x DM).
 */

const channelFindUnique = vi.fn();
const messageCreate = vi.fn();
const messageFindFirst = vi.fn();
const messageFindUniqueOrThrow = vi.fn();
const attachmentUpdateMany = vi.fn();

const txMock = {
  message: {
    create: messageCreate,
    findUniqueOrThrow: messageFindUniqueOrThrow,
  },
  attachment: { updateMany: attachmentUpdateMany },
};

vi.mock("@aether/db", () => ({
  prisma: {
    channel: { findUnique: channelFindUnique },
    message: { findFirst: messageFindFirst },
    $transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
  },
}));

const loadDmAccess = vi.fn();
const loadMemberAccess = vi.fn();
const getChannelPermissions = vi.fn();

vi.mock("@aether/access", () => ({
  loadDmAccess,
  loadMemberAccess,
  getChannelPermissions,
  estaSilenciado: (u: { silenciadoEm: Date | null; silenciadoAte: Date | null }) =>
    !!u.silenciadoEm &&
    !(u.silenciadoAte && u.silenciadoAte.getTime() < Date.now()),
}));

const publicarMensagemCriada = vi.fn();
vi.mock("../../apps/realtime/src/domain-events", () => ({ publicarMensagemCriada }));

const { enviarMensagem } = await import("../../apps/realtime/src/enviar-mensagem");

// io falso: registra para onde e o que foi emitido
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

const ATOR = { id: "u_1", silenciadoEm: null, silenciadoAte: null };

/** Linha que `MESSAGE_SELECT` traria, no formato que `toPublicMessage` aceita. */
const linhaMensagem = (over: Record<string, unknown> = {}) => ({
  id: "m_1",
  channelId: "c_1",
  dmChannelId: null,
  reactions: [],
  anexos: [],
  content: "oi",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  editedAt: null,
  author: {
    id: "u_1",
    username: "ryan",
    displayName: "Ryan",
    avatarUrl: null,
    avatarEstaticoUrl: null,
    status: "ONLINE",
    molduraId: null,
    decoracao: null,
    assinatura: null,
  },
  replyTo: null,
  ...over,
});

beforeEach(() => {
  for (const m of [
    channelFindUnique,
    messageCreate,
    messageFindFirst,
    messageFindUniqueOrThrow,
    attachmentUpdateMany,
    loadDmAccess,
    loadMemberAccess,
    getChannelPermissions,
  ]) {
    m.mockReset();
  }
  messageCreate.mockResolvedValue({ id: "m_1" });
  messageFindUniqueOrThrow.mockResolvedValue(linhaMensagem());
});

describe("enviarMensagem — recusas", () => {
  it("ator silenciado -> recusa, sem tocar o banco", async () => {
    const { io } = fakeIo();
    const r = await enviarMensagem(io, {
      ator: { id: "u_1", silenciadoEm: new Date(), silenciadoAte: null },
      conversationId: "c_1",
      content: "oi",
      origem: "gateway",
    });
    expect(r).toEqual({
      ok: false,
      error: "Sua conta está silenciada e não pode enviar mensagens.",
      codigo: "silenciado",
    });
    expect(channelFindUnique).not.toHaveBeenCalled();
  });

  it("mensagem vazia sem anexo -> erro de validação", async () => {
    const { io } = fakeIo();
    const r = await enviarMensagem(io, {
      ator: ATOR,
      conversationId: "c_1",
      content: "   ",
      origem: "gateway",
    });
    expect(r.ok).toBe(false);
  });

  it("conversa que não autoriza -> 'Conversa não encontrada'", async () => {
    const { io } = fakeIo();
    channelFindUnique.mockResolvedValue({ serverId: "s_1", type: "TEXT" });
    loadMemberAccess.mockResolvedValue({ serverId: "s_1", memberId: "mem_1" });
    getChannelPermissions.mockResolvedValue(0n); // sem SEND_MESSAGES

    const r = await enviarMensagem(io, {
      ator: ATOR,
      conversationId: "c_1",
      content: "oi",
      origem: "gateway",
    });
    expect(r).toEqual({
      ok: false,
      error: "Conversa nao encontrada",
      codigo: "nao_encontrada",
    });
  });

  it("canal de voz -> recusa", async () => {
    const { io } = fakeIo();
    channelFindUnique.mockResolvedValue({ serverId: "s_1", type: "VOICE" });
    loadMemberAccess.mockResolvedValue({ serverId: "s_1", memberId: "mem_1" });
    getChannelPermissions.mockResolvedValue((1n << 10n) | (1n << 6n)); // SEND + VIEW

    const r = await enviarMensagem(io, {
      ator: ATOR,
      conversationId: "c_1",
      content: "oi",
      origem: "gateway",
    });
    expect(r).toEqual({
      ok: false,
      error: "Canal de voz nao aceita mensagem",
      codigo: "canal_de_voz",
    });
  });

  it("anexo faltando -> mensagem inteira volta atrás", async () => {
    const { io } = fakeIo();
    channelFindUnique.mockResolvedValue({ serverId: "s_1", type: "TEXT" });
    loadMemberAccess.mockResolvedValue({ serverId: "s_1", memberId: "mem_1" });
    getChannelPermissions.mockResolvedValue(1n << 10n);
    attachmentUpdateMany.mockResolvedValue({ count: 1 }); // pediu 2, ligou 1

    const r = await enviarMensagem(io, {
      ator: ATOR,
      conversationId: "c_1",
      content: "",
      anexoIds: ["a_1", "a_2"],
      origem: "gateway",
    });
    expect(r).toEqual({
      ok: false,
      error: "Algum arquivo nao esta mais disponivel. Anexe de novo.",
      codigo: "anexos",
    });
  });
});

describe("enviarMensagem — envio", () => {
  it("canal: cria, emite message:new para channel:<id> com serverId e nonce", async () => {
    const { io, emits } = fakeIo();
    channelFindUnique.mockResolvedValue({ serverId: "s_1", type: "TEXT" });
    loadMemberAccess.mockResolvedValue({ serverId: "s_1", memberId: "mem_1" });
    getChannelPermissions.mockResolvedValue(1n << 10n);

    const r = await enviarMensagem(io, {
      ator: ATOR,
      conversationId: "c_1",
      content: "oi",
      nonce: "n_1",
      origem: "gateway",
    });

    expect(r.ok).toBe(true);
    expect(messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authorId: "u_1", channelId: "c_1" }),
      }),
    );
    expect(emits).toHaveLength(1);
    expect(emits[0]!.salas).toBe("channel:c_1");
    expect(emits[0]!.evento).toBe("message:new");
    expect(emits[0]!.payload).toMatchObject({ nonce: "n_1", serverId: "s_1" });
    // e o evento publico para os bots do canal
    expect(publicarMensagemCriada).toHaveBeenCalledWith(io, expect.anything(), "s_1");
  });

  it("webhook: publica sem checar membro/permissao (Etapa 13)", async () => {
    /**
     * Trava o bug que a Etapa 13 achou ao vivo: o webhook NAO e `ServerMember`
     * (Etapa 11, de proposito), entao `loadMemberAccess`/`getChannelPermissions`
     * ficam SEM MOCK aqui — se `enviarMensagem` os chamasse para `origem:
     * "webhook"`, devolveriam `undefined` e a mensagem seria recusada com
     * "Conversa nao encontrada", que era exatamente o defeito em producao.
     */
    const { io, emits } = fakeIo();
    channelFindUnique.mockResolvedValue({ serverId: "s_1", type: "TEXT" });

    const r = await enviarMensagem(io, {
      ator: { id: "u_webhook", silenciadoEm: null, silenciadoAte: null },
      conversationId: "c_1",
      content: "novo jogador entrou",
      origem: "webhook",
    });

    expect(r.ok).toBe(true);
    expect(loadMemberAccess).not.toHaveBeenCalled();
    expect(getChannelPermissions).not.toHaveBeenCalled();
    expect(emits[0]!.salas).toBe("channel:c_1");
  });

  it("webhook: canal inexistente -> 'Conversa nao encontrada', sem tentar DM", async () => {
    const { io } = fakeIo();
    channelFindUnique.mockResolvedValue(null);

    const r = await enviarMensagem(io, {
      ator: { id: "u_webhook", silenciadoEm: null, silenciadoAte: null },
      conversationId: "c_apagado",
      content: "oi",
      origem: "webhook",
    });

    expect(r).toEqual({
      ok: false,
      error: "Conversa nao encontrada",
      codigo: "nao_encontrada",
    });
    expect(loadDmAccess).not.toHaveBeenCalled();
  });

  it("webhook: canal virou de voz -> recusa", async () => {
    const { io } = fakeIo();
    channelFindUnique.mockResolvedValue({ serverId: "s_1", type: "VOICE" });

    const r = await enviarMensagem(io, {
      ator: { id: "u_webhook", silenciadoEm: null, silenciadoAte: null },
      conversationId: "c_1",
      content: "oi",
      origem: "webhook",
    });

    expect(r).toEqual({
      ok: false,
      error: "Canal de voz nao aceita mensagem",
      codigo: "canal_de_voz",
    });
  });

  it("dm: emite para as duas salas pessoais com serverId null", async () => {
    const { io, emits } = fakeIo();
    channelFindUnique.mockResolvedValue(null); // não é canal
    loadDmAccess.mockResolvedValue({ dmId: "dm_1", outroId: "u_2" });
    messageFindUniqueOrThrow.mockResolvedValue(
      linhaMensagem({ channelId: null, dmChannelId: "dm_1" }),
    );

    const r = await enviarMensagem(io, {
      ator: ATOR,
      conversationId: "dm_1",
      content: "oi",
      origem: "api",
    });

    expect(r.ok).toBe(true);
    expect(emits[0]!.salas).toEqual(["user:u_1", "user:u_2"]);
    expect(emits[0]!.payload).toMatchObject({ serverId: null });
  });
});
