import { describe, expect, it, vi } from "vitest";

/**
 * Token da chamada direta (`createDmCallCredentials`). O que o token deixa
 * publicar e a imposicao de verdade — o SFU recusa fonte fora da lista, tenha
 * a interface botao ou nao.
 */

vi.mock("../../apps/realtime/src/env", () => ({
  env: { livekit: { url: "wss://sfu", apiKey: "k", apiSecret: "s" } },
}));

const grants: unknown[] = [];
vi.mock("livekit-server-sdk", () => ({
  AccessToken: class {
    addGrant(grant: unknown) {
      grants.push(grant);
    }
    async toJwt() {
      return "jwt";
    }
  },
  RoomServiceClient: class {},
  TrackSource: { MICROPHONE: 2, CAMERA: 1, SCREEN_SHARE: 3, SCREEN_SHARE_AUDIO: 4 },
  TrackType: { AUDIO: 0, VIDEO: 1 },
}));

const { createDmCallCredentials } = await import("../../apps/realtime/src/livekit");

describe("createDmCallCredentials", () => {
  it("sala propria da conversa, com microfone, tela (e o som dela) e camera", async () => {
    const media = await createDmCallCredentials({ dmId: "dm1", userId: "u1", displayName: "Eu" });

    expect(grants[0]).toMatchObject({
      room: "dm:dm1",
      roomJoin: true,
      canSubscribe: true,
      canPublish: true,
      canPublishSources: [2, 3, 4, 1],
      canUpdateOwnMetadata: false,
    });
    expect(media).toMatchObject({ canPublish: true, canShareScreen: true, canUseCamera: true });
  });
});
