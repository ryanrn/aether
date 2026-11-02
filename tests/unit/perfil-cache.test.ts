import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cache do cartao de perfil: o hover busca uma vez, o cartao abre com o que ja
 * chegou, e equipar um cosmetico apaga o que ficou velho.
 */

const carregarPerfilAction = vi.fn();
vi.mock("../../apps/web/src/server/actions/perfil", () => ({
  carregarPerfilAction: (...a: unknown[]) => carregarPerfilAction(...a),
}));

const perfil = (banner: string | null) => ({
  bio: null,
  banner,
  efeito: null,
  nickname: null,
  roles: [],
  relacao: "nenhuma" as const,
  friendshipId: null,
});

let mod: typeof import("../../apps/web/src/lib/perfil-cache");

beforeEach(async () => {
  vi.resetModules();
  carregarPerfilAction.mockReset();
  mod = await import("../../apps/web/src/lib/perfil-cache");
});

describe("perfil-cache", () => {
  it("duas buscas ao mesmo tempo viram uma requisicao", async () => {
    carregarPerfilAction.mockResolvedValue({ ok: true, data: perfil("b.png") });
    const [a, b] = await Promise.all([mod.buscarPerfil("u1"), mod.buscarPerfil("u1")]);
    expect(carregarPerfilAction).toHaveBeenCalledTimes(1);
    expect(a?.banner).toBe("b.png");
    expect(b).toBe(a);
  });

  it("pre-carga recente nao busca de novo; o cartao le do cache", async () => {
    carregarPerfilAction.mockResolvedValue({ ok: true, data: perfil("b.png") });
    mod.preCarregarPerfil("u1", "s1");
    await vi.waitFor(() => expect(mod.perfilEmCache("u1", "s1")).not.toBeNull());
    mod.preCarregarPerfil("u1", "s1");
    expect(carregarPerfilAction).toHaveBeenCalledTimes(1);
    expect(mod.perfilEmCache("u1", "s1")?.banner).toBe("b.png");
  });

  it("imagens servem de qualquer servidor; esquecer apaga todas", async () => {
    carregarPerfilAction.mockResolvedValue({ ok: true, data: perfil("b.png") });
    await mod.buscarPerfil("u1", "s1");
    expect(mod.imagensEmCache("u1")).toEqual({ banner: "b.png", efeito: null });
    expect(mod.imagensEmCache("u10")).toBeNull();

    mod.esquecerPerfil("u1");
    expect(mod.perfilEmCache("u1", "s1")).toBeNull();
    expect(mod.imagensEmCache("u1")).toBeNull();
  });

  it("resposta de erro nao entra no cache", async () => {
    carregarPerfilAction.mockResolvedValue({ ok: false, error: "x" });
    expect(await mod.buscarPerfil("u1")).toBeNull();
    expect(mod.perfilEmCache("u1")).toBeNull();
  });
});
