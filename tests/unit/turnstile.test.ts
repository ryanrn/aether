import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Verificacao do Turnstile no servidor.
 *
 * A regra que importa: FECHA para token ausente/recusado, mas ABRE quando o
 * proprio siteverify da erro de infra — um humano que passou pelo widget nao
 * pode ser barrado por um soluco da Cloudflare.
 */

vi.mock("@aether/shared/log", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("server-only", () => ({}));

const { verificarTurnstile, turnstileConfigurado } = await import(
  "../../apps/web/src/server/turnstile"
);

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
});
afterEach(() => vi.unstubAllGlobals());

describe("configuração incompleta", () => {
  it("nenhuma chave: libera", async () => {
    expect(turnstileConfigurado()).toBe(false);
    expect(await verificarTurnstile("qualquer-coisa")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("só o segredo (site key faltando no build): LIBERA, não tranca o cadastro", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret-abc";
    expect(turnstileConfigurado()).toBe(false);
    expect(await verificarTurnstile(undefined)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("configurado", () => {
  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = "secret-abc";
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "0x4AAA-site";
  });

  it("token ausente -> recusa, sem nem chamar o siteverify", async () => {
    expect(await verificarTurnstile(undefined)).toBe(false);
    expect(await verificarTurnstile("")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("siteverify success:true -> aceita, e manda secret+response(+ip)", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    expect(await verificarTurnstile("tok-bom", "1.2.3.4")).toBe(true);

    const [, init] = fetchMock.mock.calls[0]!;
    const corpo = new URLSearchParams(init.body as URLSearchParams);
    expect(corpo.get("secret")).toBe("secret-abc");
    expect(corpo.get("response")).toBe("tok-bom");
    expect(corpo.get("remoteip")).toBe("1.2.3.4");
  });

  it("siteverify success:false -> recusa", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }),
    });
    expect(await verificarTurnstile("tok-ruim")).toBe(false);
  });

  it("siteverify HTTP 500 -> LIBERA (fail-open em infra)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    expect(await verificarTurnstile("tok")).toBe(true);
  });

  it("fetch rejeita (rede) -> LIBERA", async () => {
    fetchMock.mockRejectedValue(new Error("rede"));
    expect(await verificarTurnstile("tok")).toBe(true);
  });
});
