import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `applyServerMute` (apps/realtime/src/livekit.ts) — o resultado decide se o
 * moderador ve erro. So `falhou` (SFU fora do ar / erro de rede) pode virar
 * erro: quem nao esta na sala de midia nao transmite nada, e ja chegou a ser
 * classificado como `falhou` — o que fazia o `verify-phase6` cair no CI com o
 * SFU no ar.
 */

vi.mock("../../apps/realtime/src/env", () => ({
  env: { livekit: { url: "ws://sfu", apiKey: "k", apiSecret: "s" } },
}));

const listParticipants = vi.fn();
const mutePublishedTrack = vi.fn();
vi.mock("livekit-server-sdk", () => ({
  AccessToken: class {},
  RoomServiceClient: class {
    listParticipants = listParticipants;
    mutePublishedTrack = mutePublishedTrack;
  },
  TrackSource: { MICROPHONE: 2 },
  TrackType: { AUDIO: 0, VIDEO: 1 },
}));

const { applyServerMute } = await import("../../apps/realtime/src/livekit");

const ALVO = { channelId: "c1", userId: "u1", muted: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyServerMute", () => {
  it("pessoa fora da sala de midia (sala vazia/inexistente): fora_da_sala, nao falhou", async () => {
    listParticipants.mockResolvedValue([]);
    expect(await applyServerMute(ALVO)).toBe("fora_da_sala");
  });

  it("na sala sem faixa de audio: sem_faixa", async () => {
    listParticipants.mockResolvedValue([{ identity: "u1", tracks: [] }]);
    expect(await applyServerMute(ALVO)).toBe("sem_faixa");
  });

  it("com faixa: muta no SFU e devolve aplicado", async () => {
    listParticipants.mockResolvedValue([
      { identity: "u1", tracks: [{ type: 0, sid: "TR_1" }] },
    ]);
    expect(await applyServerMute(ALVO)).toBe("aplicado");
    expect(mutePublishedTrack).toHaveBeenCalledWith("channel:c1", "u1", "TR_1", true);
  });

  it("SFU nao responde: falhou (o unico caso que vira erro pro moderador)", async () => {
    listParticipants.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await applyServerMute(ALVO)).toBe("falhou");
  });
});
