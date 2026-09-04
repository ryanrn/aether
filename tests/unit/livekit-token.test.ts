import { decodeJwt } from "jose";
import { describe, expect, it, vi } from "vitest";
import { combine } from "@aether/shared";

/**
 * Grants do token do SFU (auditoria M7).
 *
 * O `verify-phase5` tem duas assercoes marcadas como falha CONHECIDA, as duas
 * sobre um canal com `deny: SCREEN_SHARE` SOZINHO no cargo padrao. O
 * `verify-phase4` nunca isola esse caso — la o deny sempre vem junto com SPEAK,
 * entao "sem SCREEN_SHARE a fonte nao entra no token" passava por tabela.
 *
 * Este teste isola: prova, sem gateway nem banco, que `createMediaCredentials`
 * traduz a permissao em `canPublishSources` corretamente — inclusive quando SO
 * o SCREEN_SHARE foi negado. Se estas assercoes passam, o defeito do
 * verify-phase5 esta no teste/fixture, nao no codigo do token.
 */

vi.mock("../../apps/realtime/src/env", () => ({
  env: {
    livekit: {
      url: "wss://sfu.example",
      apiKey: "APIkey",
      apiSecret: "segredo-de-teste-com-tamanho-suficiente",
    },
  },
}));

const { createMediaCredentials } =
  await import("../../apps/realtime/src/livekit");

/** As fontes que o token concede (enum do LiveKit, serializado como string). */
async function fontesDoToken(token: string): Promise<string[]> {
  const claims = decodeJwt(token) as {
    video?: { canPublishSources?: string[] };
  };
  return claims.video?.canPublishSources ?? [];
}

async function credenciais(permissions: bigint) {
  const media = await createMediaCredentials({
    channelId: "canal-1",
    userId: "user-1",
    displayName: "Fulano",
    permissions,
  });
  if (!media) throw new Error("createMediaCredentials devolveu null");
  return media;
}

describe("createMediaCredentials — fontes por permissao", () => {
  it("SPEAK sozinho: so microfone, sem tela nem camera", async () => {
    const media = await credenciais(
      combine("VIEW_CHANNEL", "CONNECT", "SPEAK"),
    );
    expect(media.canPublish).toBe(true);
    expect(media.canShareScreen).toBe(false);
    expect(media.canUseCamera).toBe(false);

    const fontes = await fontesDoToken(media.token);
    expect(fontes).toContain("microphone");
    expect(fontes).not.toContain("screen_share");
    expect(fontes).not.toContain("screen_share_audio");
    expect(fontes).not.toContain("camera");
  });

  it("SPEAK + SCREEN_SHARE: microfone e as duas fontes de tela", async () => {
    const media = await credenciais(
      combine("VIEW_CHANNEL", "CONNECT", "SPEAK", "SCREEN_SHARE"),
    );
    expect(media.canShareScreen).toBe(true);

    const fontes = await fontesDoToken(media.token);
    expect(fontes).toEqual(
      expect.arrayContaining([
        "microphone",
        "screen_share",
        "screen_share_audio",
      ]),
    );
  });

  it("SCREEN_SHARE negado, SPEAK mantido: token SEM fonte de tela", async () => {
    // O caso exato que o verify-phase5 exercita e que o verify-phase4 nunca
    // isola. `applyOverwrites` ja removeu o bit SCREEN_SHARE aqui.
    const media = await credenciais(
      combine("VIEW_CHANNEL", "CONNECT", "SPEAK"),
    );

    expect(media.canShareScreen).toBe(false);
    const fontes = await fontesDoToken(media.token);
    expect(fontes).toContain("microphone");
    expect(fontes).not.toContain("screen_share");
    expect(fontes).not.toContain("screen_share_audio");
  });

  it("sem SPEAK nem SCREEN_SHARE nem CAMERA: nao pode publicar nada", async () => {
    const media = await credenciais(combine("VIEW_CHANNEL", "CONNECT"));
    expect(media.canPublish).toBe(false);

    const claims = decodeJwt(media.token) as {
      video?: { canPublish?: boolean; canPublishSources?: string[] };
    };
    expect(claims.video?.canPublish).toBe(false);
    expect(claims.video?.canPublishSources ?? []).toHaveLength(0);
  });

  it("CAMERA entra como fonte propria, independente de SCREEN_SHARE", async () => {
    const media = await credenciais(
      combine("VIEW_CHANNEL", "CONNECT", "SPEAK", "CAMERA"),
    );
    expect(media.canUseCamera).toBe(true);
    expect(media.canShareScreen).toBe(false);

    const fontes = await fontesDoToken(media.token);
    expect(fontes).toEqual(expect.arrayContaining(["microphone", "camera"]));
    expect(fontes).not.toContain("screen_share");
  });

  it("o token nao deixa o cliente reescrever os proprios metadados", async () => {
    const media = await credenciais(
      combine("VIEW_CHANNEL", "CONNECT", "SPEAK"),
    );
    const claims = decodeJwt(media.token) as {
      video?: { canUpdateOwnMetadata?: boolean };
    };
    expect(claims.video?.canUpdateOwnMetadata ?? false).toBe(false);
  });
});
