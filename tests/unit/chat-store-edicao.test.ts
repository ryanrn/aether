import { beforeEach, describe, expect, it } from "vitest";
import type { PublicMessage } from "@aether/shared";
import { useRealtimeStore } from "@/lib/stores/realtime-store";

/**
 * `aplicarEdicao` no store: a mensagem troca de texto, as respostas que a
 * citam refazem o trecho, e um evento velho nao desfaz um novo.
 */

const CANAL = "canal-1";

function msg(over: Partial<PublicMessage> & { id: string }): PublicMessage {
  return {
    conversationId: CANAL,
    content: over.id,
    createdAt: "2026-11-01T12:00:00.000Z",
    editedAt: null,
    reactions: [],
    anexos: [],
    replyTo: null,
    author: {
      id: "eu",
      username: "eu",
      displayName: "Eu",
      avatarUrl: null,
    } as PublicMessage["author"],
    ...over,
  };
}

const estadoInicial = useRealtimeStore.getState();

beforeEach(() => {
  useRealtimeStore.setState(estadoInicial, true);
  useRealtimeStore.getState().seedMessages(CANAL, [
    msg({ id: "a", content: "original" }),
    msg({
      id: "b",
      replyTo: { id: "a", autorNome: "Eu", trecho: "original", apagada: false },
    }),
  ]);
});

const lista = () => useRealtimeStore.getState().messages[CANAL]!;

describe("aplicarEdicao", () => {
  it("troca o texto, marca editedAt e refaz o trecho de quem responde", () => {
    useRealtimeStore.getState().aplicarEdicao({
      messageId: "a",
      conversationId: CANAL,
      content: "texto   novo\ncom quebra",
      editedAt: "2026-11-01T12:05:00.000Z",
    });

    const [a, b] = lista();
    expect(a).toMatchObject({
      content: "texto   novo\ncom quebra",
      editedAt: "2026-11-01T12:05:00.000Z",
    });
    // Mesma regra do servidor: espacos e quebras viram um espaco so.
    expect(b!.replyTo!.trecho).toBe("texto novo com quebra");
  });

  it("evento mais velho que a edicao na tela e ignorado", () => {
    const { aplicarEdicao } = useRealtimeStore.getState();
    aplicarEdicao({
      messageId: "a",
      conversationId: CANAL,
      content: "segunda",
      editedAt: "2026-11-01T12:10:00.000Z",
    });
    aplicarEdicao({
      messageId: "a",
      conversationId: CANAL,
      content: "primeira",
      editedAt: "2026-11-01T12:05:00.000Z",
    });
    expect(lista()[0]!.content).toBe("segunda");
  });

  it("conversa nao carregada: nada muda, nem o objeto do estado", () => {
    const antes = useRealtimeStore.getState().messages;
    useRealtimeStore.getState().aplicarEdicao({
      messageId: "x",
      conversationId: "outra",
      content: "y",
      editedAt: "2026-11-01T12:05:00.000Z",
    });
    expect(useRealtimeStore.getState().messages).toBe(antes);
  });
});
