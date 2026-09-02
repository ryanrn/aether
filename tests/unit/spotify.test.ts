import { beforeAll, describe, expect, it } from "vitest";
import { safeMusicActivity, safeSpotifyArt } from "@aether/shared";

/**
 * O que viaja pela presenca do Spotify passa por `safeMusicActivity` /
 * `safeSpotifyArt` antes de sair do gateway — o mesmo principio do
 * `safeGameCover`. O que importa provar:
 *
 *  - sem titulo, nao ha atividade (o cartao nao teria o que mostrar);
 *  - a capa so passa se for do CDN do Spotify (host travado);
 *  - o link so passa se for uma URL de faixa do open.spotify.com;
 *  - campos gigantes sao cortados, nao recusados — o evento vai para a sala.
 */

describe("safeSpotifyArt", () => {
  it("aceita uma URL do i.scdn.co", () => {
    expect(safeSpotifyArt("https://i.scdn.co/image/ab67616d0000b273abcdef")).toBe(
      "https://i.scdn.co/image/ab67616d0000b273abcdef",
    );
  });

  it("recusa outro host, mesmo https", () => {
    expect(safeSpotifyArt("https://evil.example/image/x")).toBeNull();
    expect(safeSpotifyArt("https://i.scdn.co.evil.com/image/x")).toBeNull();
    expect(safeSpotifyArt("javascript:alert(1)")).toBeNull();
    expect(safeSpotifyArt(42)).toBeNull();
  });
});

describe("safeMusicActivity", () => {
  it("monta a atividade a partir do que o Spotify deu", () => {
    const a = safeMusicActivity({
      title: "MVP",
      artists: "Ryu, The Runner, Veigh, 6ee",
      art: "https://i.scdn.co/image/ab67616d0000b273aaa",
      url: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
    });
    expect(a).toMatchObject({
      title: "MVP",
      artists: "Ryu, The Runner, Veigh, 6ee",
      art: "https://i.scdn.co/image/ab67616d0000b273aaa",
      url: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
    });
    expect(typeof a?.since).toBe("string");
  });

  it("sem titulo, devolve null", () => {
    expect(safeMusicActivity({ artists: "alguem" })).toBeNull();
    expect(safeMusicActivity({ title: "   " })).toBeNull();
  });

  it("descarta capa e link de origem estranha, mas mantem a faixa", () => {
    const a = safeMusicActivity({
      title: "Faixa",
      art: "https://evil.example/x",
      url: "https://evil.example/track/x",
    });
    expect(a?.title).toBe("Faixa");
    expect(a?.art).toBeNull();
    expect(a?.url).toBeNull();
  });

  it("corta titulo e artistas gigantes", () => {
    const a = safeMusicActivity({
      title: "x".repeat(500),
      artists: "y".repeat(500),
    });
    expect(a?.title.length).toBe(200);
    expect(a?.artists.length).toBe(300);
  });
});

describe("secret-box (cifra dos tokens)", () => {
  beforeAll(() => {
    process.env.AUTH_SECRET =
      process.env.AUTH_SECRET ?? "x".repeat(48);
  });

  it("cifra e decifra de volta ao original", async () => {
    const { cifrar, decifrar } = await import("../../packages/db/src/secret-box");
    const segredo = "AQD-refresh-token-do-spotify-1234567890";
    const cofre = cifrar(segredo);
    expect(cofre).not.toContain(segredo);
    expect(cofre.startsWith("v1.")).toBe(true);
    expect(decifrar(cofre)).toBe(segredo);
  });

  it("recusa um cofre adulterado (GCM)", async () => {
    const { cifrar, decifrar } = await import("../../packages/db/src/secret-box");
    const cofre = cifrar("segredo");
    const partes = cofre.split(".");
    // mexe no ciphertext
    const adulterado = `${partes[0]}.${partes[1]}.${partes[2]}.${Buffer.from("outro").toString("base64")}`;
    expect(() => decifrar(adulterado)).toThrow();
  });
});
