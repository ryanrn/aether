import { describe, expect, it, vi } from "vitest";

/**
 * `provedoresConhecidos` — a lista que a aba "Apps conectados" renderiza.
 *
 * O que importa aqui: TODO provedor previsto no enum aparece, mesmo os sem
 * adaptador. E o que deixa a tela dizer "ainda nao disponivel" em vez de
 * simplesmente omitir Steam/Twitch/Riot e nunca contar que estao vindo.
 */

// So o SPOTIFY tem adaptador, e ele esta configurado — como em producao hoje.
vi.mock("../../packages/access/src/conexoes/spotify", () => ({
  spotifyProvedor: {
    id: "SPOTIFY",
    nome: "Spotify",
    configurado: () => true,
    urlDeLogin: () => "",
    concluirLogin: async () => ({}),
  },
}));

const { provedoresConhecidos, provedoresDisponiveis } = await import(
  "../../packages/access/src/conexoes/registro"
);

describe("provedoresConhecidos", () => {
  it("lista os QUATRO, com ou sem adaptador", () => {
    const ids = provedoresConhecidos().map((p) => p.id);
    expect(ids.sort()).toEqual(["RIOT", "SPOTIFY", "STEAM", "TWITCH"]);
  });

  it("marca implementado so quem tem adaptador", () => {
    const porId = Object.fromEntries(
      provedoresConhecidos().map((p) => [p.id, p]),
    );
    expect(porId.SPOTIFY!.implementado).toBe(true);
    expect(porId.TWITCH!.implementado).toBe(false);
    expect(porId.STEAM!.implementado).toBe(false);
    expect(porId.RIOT!.implementado).toBe(false);
  });

  it("todo provedor tem nome, mesmo sem adaptador", () => {
    for (const p of provedoresConhecidos()) {
      expect(p.nome.length).toBeGreaterThan(0);
    }
  });

  it("`provedoresDisponiveis` e um subconjunto — so implementado E configurado", () => {
    const disp = provedoresDisponiveis().map((p) => p.id);
    expect(disp).toEqual(["SPOTIFY"]);
  });
});
