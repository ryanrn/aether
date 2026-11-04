import { beforeEach, describe, expect, it } from "vitest";
import { useRealtimeStore } from "@/lib/stores/realtime-store";

/** Nao lidas persistidas (P1-3) — o lado da store. */

const estadoInicial = useRealtimeStore.getState();

beforeEach(() => {
  useRealtimeStore.setState(estadoInicial, true);
});

describe("hidratarNaoLidas", () => {
  it("substitui o contador em memoria pelo do servidor", () => {
    useRealtimeStore.setState({ unread: { velho: 5 } });
    useRealtimeStore.getState().hidratarNaoLidas({
      naoLidas: { a: 2, b: 1 },
      serverDoCanal: { a: "srv-1" },
    });
    const s = useRealtimeStore.getState();
    expect(s.unread).toEqual({ a: 2, b: 1 });
    expect(s.serverDoCanal).toEqual({ a: "srv-1" });
  });

  it("a conversa aberta nao acende", () => {
    useRealtimeStore.getState().setActiveChannel("a");
    useRealtimeStore.getState().hidratarNaoLidas({
      naoLidas: { a: 2, b: 1 },
      serverDoCanal: {},
    });
    expect(useRealtimeStore.getState().unread).toEqual({ b: 1 });
  });
});

describe("marcarLidaAqui", () => {
  it("zera so a conversa lida em outro aparelho", () => {
    useRealtimeStore.setState({ unread: { a: 2, b: 1 } });
    useRealtimeStore.getState().marcarLidaAqui("a");
    expect(useRealtimeStore.getState().unread).toEqual({ b: 1 });
  });

  it("conversa sem nao lida: o estado nao muda", () => {
    useRealtimeStore.setState({ unread: { b: 1 } });
    const antes = useRealtimeStore.getState().unread;
    useRealtimeStore.getState().marcarLidaAqui("a");
    expect(useRealtimeStore.getState().unread).toBe(antes);
  });
});
