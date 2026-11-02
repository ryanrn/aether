import { beforeEach, describe, expect, it } from "vitest";
import type { PublicMessage } from "@aether/shared";
import { mencionaVoce, useRealtimeStore } from "@/lib/stores/realtime-store";

/** Nao lidas persistidas (P1-3) e mencoes (P1-2) — o lado da store. */

const estadoInicial = useRealtimeStore.getState();

beforeEach(() => {
  useRealtimeStore.setState(estadoInicial, true);
});

describe("hidratarNaoLidas", () => {
  it("substitui o contador em memoria pelo do servidor", () => {
    useRealtimeStore.setState({ unread: { velho: 5 }, mencoes: { velho: 1 } });
    useRealtimeStore.getState().hidratarNaoLidas({
      naoLidas: { a: 2, b: 1 },
      serverDoCanal: { a: "srv-1" },
      mencoes: { a: 1 },
      meusCargos: { "srv-1": ["cargo-x"] },
    });
    const s = useRealtimeStore.getState();
    expect(s.unread).toEqual({ a: 2, b: 1 });
    expect(s.mencoes).toEqual({ a: 1 });
    expect(s.meusCargos).toEqual({ "srv-1": ["cargo-x"] });
    expect(s.serverDoCanal).toEqual({ a: "srv-1" });
  });

  it("a conversa aberta nao acende, nem nas mencoes", () => {
    useRealtimeStore.getState().setActiveChannel("a");
    useRealtimeStore.getState().hidratarNaoLidas({
      naoLidas: { a: 2, b: 1 },
      serverDoCanal: {},
      mencoes: { a: 2 },
      meusCargos: {},
    });
    expect(useRealtimeStore.getState().unread).toEqual({ b: 1 });
    expect(useRealtimeStore.getState().mencoes).toEqual({});
  });
});

describe("marcarLidaAqui", () => {
  it("zera so a conversa lida em outro aparelho, mencoes junto", () => {
    useRealtimeStore.setState({ unread: { a: 2, b: 1 }, mencoes: { a: 1 } });
    useRealtimeStore.getState().marcarLidaAqui("a");
    expect(useRealtimeStore.getState().unread).toEqual({ b: 1 });
    expect(useRealtimeStore.getState().mencoes).toEqual({});
  });

  it("conversa sem nao lida: o estado nao muda", () => {
    useRealtimeStore.setState({ unread: { b: 1 } });
    const antes = useRealtimeStore.getState().unread;
    useRealtimeStore.getState().marcarLidaAqui("a");
    expect(useRealtimeStore.getState().unread).toBe(antes);
  });
});

// --- mencoes ao vivo -------------------------------------------------------

const EU = "eu";

function msg(over: Partial<PublicMessage>): PublicMessage {
  return {
    id: `m-${Math.random()}`,
    conversationId: "canal-1",
    content: "oi",
    createdAt: new Date().toISOString(),
    editedAt: null,
    reactions: [],
    anexos: [],
    replyTo: null,
    mencoes: { usuarios: [], cargos: [], todos: false },
    author: { id: "outro", username: "outro", displayName: "Outro", avatarUrl: null } as PublicMessage["author"],
    ...over,
  };
}

describe("mencionaVoce", () => {
  const nada = { usuarios: [], cargos: [], todos: false };

  it("pela pessoa, por @everyone e por cargo seu", () => {
    expect(mencionaVoce({ mencoes: { ...nada, usuarios: [{ id: EU, nome: "Eu" }] } }, EU, [])).toBe(true);
    expect(mencionaVoce({ mencoes: { ...nada, todos: true } }, EU, [])).toBe(true);
    expect(mencionaVoce({ mencoes: { ...nada, cargos: [{ id: "c1", nome: "Mod", cor: null }] } }, EU, ["c1"])).toBe(true);
  });

  it("cargo que nao e seu, ou mencao a outra pessoa, nao conta", () => {
    expect(mencionaVoce({ mencoes: { ...nada, cargos: [{ id: "c1", nome: "Mod", cor: null }] } }, EU, ["c2"])).toBe(false);
    expect(mencionaVoce({ mencoes: { ...nada, usuarios: [{ id: "x", nome: "X" }] } }, EU, [])).toBe(false);
  });

  it("conversa direta (cargos nulo): toda mensagem e para voce", () => {
    expect(mencionaVoce({ mencoes: nada }, EU, null)).toBe(true);
  });

  it("mensagem de gateway antigo, sem o campo, nao quebra", () => {
    const antiga = {} as Pick<PublicMessage, "mencoes">;
    expect(mencionaVoce(antiga, EU, [])).toBe(false);
  });
});

describe("receiveMessage conta mencoes", () => {
  beforeEach(() => {
    useRealtimeStore.setState({ selfUserId: EU, meusCargos: { srv: ["c1"] } });
  });

  it("mencao em canal fechado soma em mencoes e em nao lidas", () => {
    const { receiveMessage } = useRealtimeStore.getState();
    receiveMessage(msg({ mencoes: { usuarios: [{ id: EU, nome: "Eu" }], cargos: [], todos: false } }), null, "srv");
    receiveMessage(msg({}), null, "srv");
    const s = useRealtimeStore.getState();
    expect(s.unread["canal-1"]).toBe(2);
    expect(s.mencoes["canal-1"]).toBe(1);
  });

  it("canal aberto nao conta, e abrir zera as mencoes", () => {
    const { receiveMessage, setActiveChannel } = useRealtimeStore.getState();
    receiveMessage(msg({ mencoes: { usuarios: [], cargos: [], todos: true } }), null, "srv");
    expect(useRealtimeStore.getState().mencoes["canal-1"]).toBe(1);
    setActiveChannel("canal-1");
    expect(useRealtimeStore.getState().mencoes["canal-1"]).toBeUndefined();
    receiveMessage(msg({ mencoes: { usuarios: [], cargos: [], todos: true } }), null, "srv");
    expect(useRealtimeStore.getState().mencoes["canal-1"]).toBeUndefined();
  });

  it("a propria mensagem nunca conta", () => {
    useRealtimeStore.getState().receiveMessage(
      msg({ author: { id: EU } as PublicMessage["author"], mencoes: { usuarios: [], cargos: [], todos: true } }),
      null,
      "srv",
    );
    expect(useRealtimeStore.getState().mencoes["canal-1"]).toBeUndefined();
  });

  it("DM de outra pessoa conta como mencao", () => {
    useRealtimeStore.getState().receiveMessage(msg({ conversationId: "dm-1" }), null, null);
    expect(useRealtimeStore.getState().mencoes["dm-1"]).toBe(1);
  });
});
