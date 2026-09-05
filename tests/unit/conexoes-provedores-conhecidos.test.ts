import { describe, expect, it, vi } from "vitest";

/**
 * `provedoresConhecidos` — a lista que a aba "Apps conectados" renderiza.
 *
 * O que importa aqui: TODO provedor previsto no enum aparece, mesmo os sem
 * adaptador. E o que deixa a tela dizer "ainda nao disponivel" em vez de
 * simplesmente omitir Steam/Twitch/Riot e nunca contar que estao vindo.
 */

// Adaptadores mockados: SPOTIFY configurado + com atividade; TWITCH
// configurado + cracha (sem lerAtividade); STEAM e RIOT seguem `null` no
// registro.
vi.mock("../../packages/access/src/conexoes/spotify", () => ({
  spotifyProvedor: {
    id: "SPOTIFY",
    nome: "Spotify",
    configurado: () => true,
    urlDeLogin: () => "",
    concluirLogin: async () => ({}),
    lerAtividade: async () => null,
  },
}));
vi.mock("../../packages/access/src/conexoes/twitch", () => ({
  twitchProvedor: {
    id: "TWITCH",
    nome: "Twitch",
    configurado: () => true,
    urlDeLogin: () => "",
    concluirLogin: async () => ({}),
    // sem lerAtividade
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
    expect(porId.TWITCH!.implementado).toBe(true);
    expect(porId.STEAM!.implementado).toBe(false);
    expect(porId.RIOT!.implementado).toBe(false);
  });

  it("temAtividade separa quem produz status ao vivo de quem e cracha", () => {
    const porId = Object.fromEntries(
      provedoresConhecidos().map((p) => [p.id, p]),
    );
    expect(porId.SPOTIFY!.temAtividade).toBe(true);
    expect(porId.TWITCH!.temAtividade).toBe(false);
    expect(porId.STEAM!.temAtividade).toBe(false);
  });

  it("todo provedor tem nome, mesmo sem adaptador", () => {
    for (const p of provedoresConhecidos()) {
      expect(p.nome.length).toBeGreaterThan(0);
    }
  });

  it("`provedoresDisponiveis` e um subconjunto — so implementado E configurado", () => {
    const disp = provedoresDisponiveis().map((p) => p.id).sort();
    expect(disp).toEqual(["SPOTIFY", "TWITCH"]);
  });
});
