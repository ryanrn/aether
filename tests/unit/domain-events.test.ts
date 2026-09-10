import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `publicarMensagemCriada` (Etapa 10) — o `PublicMessage` interno vira o
 * `MESSAGE_CREATE` publico e vai para os bots do canal.
 *
 * Trava: o shape enxuto (sem `PublicUser` inteiro), `author.bot` derivado de
 * `kind`, `replyToId` de `replyTo`, e a entrega na sala do canal certo.
 */

const dispatchParaBots = vi.fn();
vi.mock("../../apps/realtime/src/bot-gateway", () => ({ dispatchParaBots }));

const { publicarMensagemCriada } = await import(
  "../../apps/realtime/src/domain-events"
);

const io = { marcador: "io" } as never;

function msg(over: Record<string, unknown> = {}) {
  return {
    id: "m_1",
    conversationId: "c_1",
    content: "ping",
    createdAt: "2026-01-01T00:00:00.000Z",
    editedAt: null,
    reactions: [],
    anexos: [],
    replyTo: null,
    author: {
      id: "u_1",
      username: "ryan",
      displayName: "Ryan",
      avatarUrl: null,
      status: "ONLINE",
      kind: "HUMAN",
      plano: "FREE",
      moldura: null,
      decoracao: null,
    },
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => dispatchParaBots.mockReset());

describe("publicarMensagemCriada", () => {
  it("humano: monta MESSAGE_CREATE e entrega na sala do canal", () => {
    publicarMensagemCriada(io, msg(), "s_1");
    expect(dispatchParaBots).toHaveBeenCalledWith(io, "c_1", {
      t: "MESSAGE_CREATE",
      d: {
        id: "m_1",
        channelId: "c_1",
        serverId: "s_1",
        content: "ping",
        createdAt: "2026-01-01T00:00:00.000Z",
        replyToId: null,
        author: {
          id: "u_1",
          username: "ryan",
          displayName: "Ryan",
          avatarUrl: null,
          bot: false,
        },
      },
    });
  });

  it("autor BOT -> author.bot true", () => {
    publicarMensagemCriada(io, msg({ author: { ...msg().author, kind: "BOT" } }), "s_1");
    const d = dispatchParaBots.mock.calls[0]![2].d;
    expect(d.author.bot).toBe(true);
  });

  it("autor WEBHOOK -> author.bot true", () => {
    publicarMensagemCriada(
      io,
      msg({ author: { ...msg().author, kind: "WEBHOOK" } }),
      "s_1",
    );
    expect(dispatchParaBots.mock.calls[0]![2].d.author.bot).toBe(true);
  });

  it("resposta -> replyToId", () => {
    publicarMensagemCriada(
      io,
      msg({ replyTo: { id: "m_0", autorNome: "X", trecho: "…", apagada: false } }),
      "s_1",
    );
    expect(dispatchParaBots.mock.calls[0]![2].d.replyToId).toBe("m_0");
  });
});
