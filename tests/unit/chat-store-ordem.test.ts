import { beforeEach, describe, expect, it } from "vitest";
import type { PublicMessage } from "@aether/shared";
import { useRealtimeStore } from "@/lib/stores/realtime-store";

/**
 * Ordem e deduplicacao das mensagens no store.
 *
 * O `mergeById` foi otimizado (caminho rapido para o caso comum de "chegou uma
 * mensagem nova no fim", e comparacao simples no lugar de `localeCompare`, que
 * e ~7x mais lento). Estes testes travam o COMPORTAMENTO para a otimizacao nao
 * poder mudar o resultado: ordem cronologica, sem duplicata, e a mensagem
 * confirmada substituindo a otimista.
 */

const CANAL = "canal-1";
const EU = "user-eu";

function msg(over: Partial<PublicMessage> & { id: string }): PublicMessage {
  return {
    conversationId: CANAL,
    content: over.id,
    createdAt: "2026-09-04T12:00:00.000Z",
    editedAt: null,
    reactions: [],
    anexos: [],
    replyTo: null,
    mencoes: { usuarios: [], cargos: [], todos: false },
    author: {
      id: EU,
      username: "eu",
      displayName: "Eu",
      avatarUrl: null,
    } as PublicMessage["author"],
    ...over,
  };
}

const t = (n: number) => new Date(Date.UTC(2026, 8, 4, 12, 0, n)).toISOString();

const estadoInicial = useRealtimeStore.getState();

beforeEach(() => {
  useRealtimeStore.setState(estadoInicial, true);
  useRealtimeStore.getState().setSelfUserId(EU);
});

const ids = () =>
  (useRealtimeStore.getState().messages[CANAL] ?? []).map((m) => m.id);

describe("ordem das mensagens", () => {
  it("seed fora de ordem sai em ordem cronologica", () => {
    useRealtimeStore
      .getState()
      .seedMessages(CANAL, [
        msg({ id: "c", createdAt: t(3) }),
        msg({ id: "a", createdAt: t(1) }),
        msg({ id: "b", createdAt: t(2) }),
      ]);
    expect(ids()).toEqual(["a", "b", "c"]);
  });

  it("mensagem nova entra no fim (caminho rapido)", () => {
    const store = useRealtimeStore.getState();
    store.seedMessages(CANAL, [
      msg({ id: "a", createdAt: t(1) }),
      msg({ id: "b", createdAt: t(2) }),
    ]);
    store.receiveMessage(msg({ id: "c", createdAt: t(3) }), null, null);
    expect(ids()).toEqual(["a", "b", "c"]);
  });

  it("mensagem ATRASADA entra no lugar certo, nao no fim", () => {
    const store = useRealtimeStore.getState();
    store.seedMessages(CANAL, [
      msg({ id: "a", createdAt: t(1) }),
      msg({ id: "c", createdAt: t(3) }),
    ]);
    // Chegou depois, mas foi criada antes: o caminho rapido NAO pode pegar.
    store.receiveMessage(msg({ id: "b", createdAt: t(2) }), null, null);
    expect(ids()).toEqual(["a", "b", "c"]);
  });

  it("nao duplica quando a mesma mensagem chega duas vezes", () => {
    const store = useRealtimeStore.getState();
    store.seedMessages(CANAL, [msg({ id: "a", createdAt: t(1) })]);
    store.receiveMessage(msg({ id: "a", createdAt: t(1) }), null, null);
    expect(ids()).toEqual(["a"]);
  });

  it("seed sobreposto ao historico nao duplica e mantem a ordem", () => {
    const store = useRealtimeStore.getState();
    store.seedMessages(CANAL, [
      msg({ id: "a", createdAt: t(1) }),
      msg({ id: "b", createdAt: t(2) }),
    ]);
    store.seedMessages(CANAL, [
      msg({ id: "b", createdAt: t(2) }),
      msg({ id: "c", createdAt: t(3) }),
    ]);
    expect(ids()).toEqual(["a", "b", "c"]);
  });

  it("mesmo instante desempata pelo id, de forma estavel", () => {
    useRealtimeStore
      .getState()
      .seedMessages(CANAL, [
        msg({ id: "z", createdAt: t(1) }),
        msg({ id: "a", createdAt: t(1) }),
      ]);
    expect(ids()).toEqual(["a", "z"]);
  });

  it("a confirmada substitui a otimista pelo nonce, sem duplicar", () => {
    const store = useRealtimeStore.getState();
    store.seedMessages(CANAL, [msg({ id: "a", createdAt: t(1) })]);
    // Envio otimista entra com nonce e id provisorio.
    useRealtimeStore.setState((s) => ({
      messages: {
        ...s.messages,
        [CANAL]: [
          ...(s.messages[CANAL] ?? []),
          {
            ...msg({ id: "tmp", createdAt: t(2) }),
            pending: true,
            nonce: "n1",
          },
        ],
      },
    }));
    store.receiveMessage(msg({ id: "real", createdAt: t(2) }), "n1", null);
    expect(ids()).toEqual(["a", "real"]);
  });
});

describe("removerMensagem (excluir)", () => {
  it("some da lista onde estava carregada", () => {
    const store = useRealtimeStore.getState();
    store.seedMessages(CANAL, [
      msg({ id: "a", createdAt: t(1) }),
      msg({ id: "b", createdAt: t(2) }),
    ]);
    store.removerMensagem("a");
    expect(ids()).toEqual(["b"]);
  });

  it("id que nao esta carregado em nenhuma conversa: nao muda nada", () => {
    const store = useRealtimeStore.getState();
    store.seedMessages(CANAL, [msg({ id: "a", createdAt: t(1) })]);
    const antes = useRealtimeStore.getState().messages;
    store.removerMensagem("nao-existe");
    expect(useRealtimeStore.getState().messages).toBe(antes); // mesma referencia
  });

  it("quem respondia a ela ganha 'apagada' na hora, sem esperar reload", () => {
    const store = useRealtimeStore.getState();
    store.seedMessages(CANAL, [
      msg({ id: "original", createdAt: t(1), content: "segredo" }),
      msg({
        id: "resposta",
        createdAt: t(2),
        replyTo: { id: "original", autorNome: "Eu", trecho: "segredo", apagada: false },
      }),
    ]);
    store.removerMensagem("original");

    const lista = useRealtimeStore.getState().messages[CANAL] ?? [];
    expect(lista.map((m) => m.id)).toEqual(["resposta"]);
    expect(lista[0]!.replyTo).toEqual({
      id: "original",
      autorNome: "Eu",
      trecho: "",
      apagada: true,
    });
  });
});
