import { beforeEach, describe, expect, it } from "vitest";
import type { VoiceParticipant } from "@aether/shared";
import { useRealtimeStore } from "@/lib/stores/realtime-store";

/**
 * Transicoes do estado de voz no store do cliente (auditoria M6).
 *
 * O ponto que importa e a diferenca entre `selfVoice`/`media` (estado da
 * chamada, volatil) e `voiceIntent` (o DESEJO de estar na call). O religa-call
 * do reconnect depende de `voiceIntent` sobreviver a uma queda de socket e a
 * uma troca de servidor, e sumir de vez quando EU saio da call. Um erro aqui
 * ou apaga chamada a cada piscada de rede, ou deixa a pessoa "presa" tentando
 * reentrar num canal que ela mesma abandonou.
 *
 * Sem `window`: em node os helpers de sessionStorage viram no-op e o
 * `voiceIntent` fica so em memoria — suficiente para a logica de transicao.
 */

const EU = "user-eu";
const OUTRO = "user-outro";

function participante(over: Partial<VoiceParticipant> = {}): VoiceParticipant {
  return {
    userId: EU,
    channelId: "canal-1",
    selfMuted: false,
    selfDeafened: false,
    serverMuted: false,
    serverDeafened: false,
    streaming: false,
    camera: false,
    speaking: false,
    joinedAt: null,
    user: {
      id: over.userId ?? EU,
      username: "eu",
      displayName: "Eu",
      avatarUrl: null,
      moldura: null,
    } as VoiceParticipant["user"],
    ...over,
  };
}

const estadoInicial = useRealtimeStore.getState();

beforeEach(() => {
  useRealtimeStore.setState(estadoInicial, true);
  useRealtimeStore.getState().setSelfUserId(EU);
});

describe("updateVoice", () => {
  it("adiciona participante remoto ao mapa sem tocar selfVoice", () => {
    useRealtimeStore
      .getState()
      .updateVoice(participante({ userId: OUTRO, channelId: "canal-1" }));

    const s = useRealtimeStore.getState();
    expect(s.voice[OUTRO]).toBeDefined();
    expect(s.selfVoice).toBeNull();
    expect(s.voiceIntent).toBeNull();
  });

  it("entrar eu mesmo fixa selfVoice e voiceIntent no canal", () => {
    useRealtimeStore
      .getState()
      .updateVoice(participante({ userId: EU, channelId: "canal-1" }));

    const s = useRealtimeStore.getState();
    expect(s.selfVoice?.channelId).toBe("canal-1");
    expect(s.voiceIntent).toEqual({ channelId: "canal-1" });
  });

  it("ser movido de canal leva o voiceIntent junto", () => {
    const store = useRealtimeStore.getState();
    store.updateVoice(participante({ userId: EU, channelId: "canal-1" }));
    store.updateVoice(participante({ userId: EU, channelId: "canal-2" }));

    const s = useRealtimeStore.getState();
    expect(s.selfVoice?.channelId).toBe("canal-2");
    expect(s.voiceIntent).toEqual({ channelId: "canal-2" });
  });

  it("saida de um remoto (channelId null) nao mexe na minha intencao", () => {
    const store = useRealtimeStore.getState();
    store.updateVoice(participante({ userId: EU, channelId: "canal-1" }));
    store.updateVoice(participante({ userId: OUTRO, channelId: "canal-1" }));

    store.updateVoice(participante({ userId: OUTRO, channelId: null }));

    const s = useRealtimeStore.getState();
    expect(s.voice[OUTRO]).toBeUndefined();
    expect(s.voice[EU]).toBeDefined();
    expect(s.voiceIntent).toEqual({ channelId: "canal-1" });
  });

  it("EU saindo (channelId null) zera selfVoice, media E voiceIntent", () => {
    const store = useRealtimeStore.getState();
    store.updateVoice(participante({ userId: EU, channelId: "canal-1" }));
    store.setMedia({
      url: "wss://x",
      token: "t",
      expiresAt: Date.now() + 1000,
    } as never);
    store.setMediaConnected(true);

    store.updateVoice(participante({ userId: EU, channelId: null }));

    const s = useRealtimeStore.getState();
    expect(s.voice[EU]).toBeUndefined();
    expect(s.selfVoice).toBeNull();
    expect(s.media).toBeNull();
    expect(s.mediaConnected).toBe(false);
    expect(s.voiceIntent).toBeNull();
  });
});

describe("clearVolatile", () => {
  it("derruba a chamada mas PRESERVA voiceIntent (base do religa-call)", () => {
    const store = useRealtimeStore.getState();
    store.updateVoice(participante({ userId: EU, channelId: "canal-1" }));
    store.setMedia({
      url: "wss://x",
      token: "t",
      expiresAt: Date.now() + 1000,
    } as never);
    store.setMediaConnected(true);
    store.updateVoice(participante({ userId: OUTRO, channelId: "canal-1" }));

    store.clearVolatile();

    const s = useRealtimeStore.getState();
    expect(s.voice).toEqual({});
    expect(s.selfVoice).toBeNull();
    expect(s.media).toBeNull();
    expect(s.mediaConnected).toBe(false);
    expect(s.micTest).toBe(false);
    // o unico campo de voz que sobrevive
    expect(s.voiceIntent).toEqual({ channelId: "canal-1" });
  });
});

describe("setVoiceIntent", () => {
  it("null limpa a intencao", () => {
    const store = useRealtimeStore.getState();
    store.setVoiceIntent("canal-9");
    expect(useRealtimeStore.getState().voiceIntent).toEqual({
      channelId: "canal-9",
    });
    store.setVoiceIntent(null);
    expect(useRealtimeStore.getState().voiceIntent).toBeNull();
  });
});
