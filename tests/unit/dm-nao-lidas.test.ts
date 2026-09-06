import { beforeEach, describe, expect, it } from "vitest";
import type { PublicMessage, PublicUser } from "@aether/shared";
import { useRealtimeStore } from "@/lib/stores/realtime-store";

/**
 * Nao-lidas de conversa direta (o badge no botao de Amigos do trilho).
 *
 * A infra ja existia: a DM chega pela sala pessoal e `receiveMessage`
 * incrementa `unread[dmId]`. O que se trava aqui:
 *  - a conversa e REGISTRADA (`conversasDm`) quando a DM de outra pessoa chega;
 *  - a nao-lida de DM SOBREVIVE a troca de servidor (nao e de servidor nenhum);
 *  - abrir a conversa zera.
 */

const EU = "user-eu";
const AMIGO = "user-amigo";
const DM = "dm-1";

const amigo: PublicUser = {
  id: AMIGO,
  username: "amigo",
  displayName: "Amigo",
  avatarUrl: null,
} as PublicUser;

function dmMsg(autor: string): PublicMessage {
  return {
    id: `m-${Math.random()}`,
    conversationId: DM,
    content: "oi",
    createdAt: new Date().toISOString(),
    editedAt: null,
    reactions: [],
    anexos: [],
    author:
      autor === EU
        ? ({ id: EU, username: "eu", displayName: "Eu", avatarUrl: null } as PublicUser)
        : amigo,
  } as PublicMessage;
}

const estadoInicial = useRealtimeStore.getState();

beforeEach(() => {
  useRealtimeStore.setState(estadoInicial, true);
  useRealtimeStore.getState().setSelfUserId(EU);
});

describe("nao-lidas de DM", () => {
  it("DM de outra pessoa registra a conversa e conta como nao lida", () => {
    useRealtimeStore.getState().receiveMessage(dmMsg(AMIGO), null, null);

    const s = useRealtimeStore.getState();
    expect(s.conversasDm[DM]?.id).toBe(AMIGO);
    expect(s.unread[DM]).toBe(1);
  });

  it("minha propria DM nao registra conversa nem conta", () => {
    useRealtimeStore.getState().receiveMessage(dmMsg(EU), null, null);

    const s = useRealtimeStore.getState();
    expect(s.conversasDm[DM]).toBeUndefined();
    expect(s.unread[DM]).toBeUndefined();
  });

  it("a nao-lida de DM sobrevive a troca de servidor", () => {
    useRealtimeStore.getState().receiveMessage(dmMsg(AMIGO), null, null);
    useRealtimeStore.getState().receiveMessage(dmMsg(AMIGO), null, null);
    expect(useRealtimeStore.getState().unread[DM]).toBe(2);

    useRealtimeStore.getState().enterServer("servidor-x");

    // canal de servidor sumiu; a DM nao
    expect(useRealtimeStore.getState().unread[DM]).toBe(2);
    expect(useRealtimeStore.getState().conversasDm[DM]?.id).toBe(AMIGO);
  });

  it("nao-lida de CANAL nao sobrevive a troca de servidor", () => {
    const msgCanal = { ...dmMsg(AMIGO), conversationId: "canal-1" };
    useRealtimeStore.getState().receiveMessage(msgCanal, null, "servidor-a");
    expect(useRealtimeStore.getState().unread["canal-1"]).toBe(1);

    useRealtimeStore.getState().enterServer("servidor-b");
    expect(useRealtimeStore.getState().unread["canal-1"]).toBeUndefined();
  });

  it("abrir a conversa zera a nao-lida", () => {
    useRealtimeStore.getState().receiveMessage(dmMsg(AMIGO), null, null);
    useRealtimeStore.getState().setActiveChannel(DM);
    expect(useRealtimeStore.getState().unread[DM]).toBeUndefined();
  });

  it("hidratarConversasDm preenche sem apagar o que ja havia", () => {
    useRealtimeStore.getState().receiveMessage(dmMsg(AMIGO), null, null);
    useRealtimeStore
      .getState()
      .hidratarConversasDm([{ id: "dm-2", outro: { ...amigo, id: "outro" } as PublicUser }]);

    const s = useRealtimeStore.getState();
    expect(Object.keys(s.conversasDm).sort()).toEqual([DM, "dm-2"]);
  });
});
