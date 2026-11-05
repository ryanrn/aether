import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVATAR_ANIMADO_MAX_BYTES } from "@aether/shared";
import {
  autorizarEnvioDeAvatarAnimado,
  confirmarAvatarAnimado,
} from "../../apps/web/src/server/storage";

/**
 * Avatar GIF enviado DIRETO do navegador ao bucket.
 *
 * O que estes testes travam e a CONFIRMACAO: o arquivo chegou ao bucket por
 * um caminho que o servidor nao viu, entao nada do que o navegador declarou
 * vale. So se aceita o caminho que o passo 1 gera, da propria pessoa, e bytes
 * que passam nas mesmas regras do envio normal. O que for reprovado e apagado.
 *
 * O `fetch` e falso: nada sai para a rede.
 */

const URL_BASE = "https://exemplo.supabase.co";
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CAMINHO = `users/u1/${"a".repeat(32)}.gif`;

const fetchFalso = vi.fn();

beforeEach(() => {
  process.env.SUPABASE_URL = URL_BASE;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-de-teste";
  fetchFalso.mockReset();
  vi.stubGlobal("fetch", fetchFalso);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Responde ao download do objeto com estes bytes; o resto devolve 200 vazio. */
function bucketCom(bytes: number[]) {
  fetchFalso.mockImplementation(async (url: string, init?: RequestInit) => {
    if (!init?.method || init.method === "GET") {
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { "content-length": String(bytes.length) },
      });
    }
    return new Response("{}", { status: 200 });
  });
}

const apagou = () =>
  fetchFalso.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");

describe("confirmarAvatarAnimado", () => {
  it("recusa caminho de OUTRA pessoa, sem nem baixar", async () => {
    const r = await confirmarAvatarAnimado("u2", CAMINHO, true);
    expect(r).toEqual({ ok: false, error: "Envio nao encontrado" });
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("recusa caminho fora do formato gerado (nada de objeto arbitrario do bucket)", async () => {
    for (const caminho of ["users/u1/../u2/x.gif", "users/u1/foto.gif", `users/u1/${"a".repeat(32)}.png`]) {
      const r = await confirmarAvatarAnimado("u1", caminho, true);
      expect(r.ok).toBe(false);
    }
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("recusa e APAGA o que nao e GIF de verdade (tipo pelos bytes)", async () => {
    bucketCom([...PNG, 0, 0, 0, 0]);
    const r = await confirmarAvatarAnimado("u1", CAMINHO, true);
    expect(r).toEqual({ ok: false, error: "Envie PNG, JPEG, WEBP ou GIF" });
    expect(apagou()).toBe(true);
  });

  it("recusa e APAGA sem plano — a action confere antes, mas quem vale e aqui", async () => {
    bucketCom(GIF);
    const r = await confirmarAvatarAnimado("u1", CAMINHO, false);
    expect(r).toEqual({ ok: false, error: "Avatar animado e exclusivo do Olimpo Pro" });
    expect(apagou()).toBe(true);
  });

  it("recusa e APAGA acima de 10 MB, mesmo que o navegador tenha declarado menos", async () => {
    fetchFalso.mockImplementation(async (_url: string, init?: RequestInit) =>
      !init?.method
        ? new Response(new Uint8Array(GIF), {
            headers: { "content-length": String(AVATAR_ANIMADO_MAX_BYTES + 1) },
          })
        : new Response("{}"),
    );
    const r = await confirmarAvatarAnimado("u1", CAMINHO, true);
    expect(r).toEqual({ ok: false, error: "Imagem maior que 10MB" });
    expect(apagou()).toBe(true);
  });

  it("objeto que nao existe no bucket: nao grava nada", async () => {
    fetchFalso.mockResolvedValue(new Response("", { status: 404 }));
    const r = await confirmarAvatarAnimado("u1", CAMINHO, true);
    expect(r.ok).toBe(false);
  });

  it("GIF valido com plano: devolve a URL publica do proprio caminho", async () => {
    bucketCom(GIF);
    const r = await confirmarAvatarAnimado("u1", CAMINHO, true);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.url).toBe(`${URL_BASE}/storage/v1/object/public/avatars/${CAMINHO}`);
    }
    expect(apagou()).toBe(false);
  });
});

describe("autorizarEnvioDeAvatarAnimado", () => {
  it("so GIF, nao vazio, ate 10 MB — recusa sem chamar o Supabase", async () => {
    expect((await autorizarEnvioDeAvatarAnimado("u1", { tamanho: 10, tipo: "image/png" })).ok).toBe(false);
    expect((await autorizarEnvioDeAvatarAnimado("u1", { tamanho: 0, tipo: "image/gif" })).ok).toBe(false);
    expect(
      (await autorizarEnvioDeAvatarAnimado("u1", {
        tamanho: AVATAR_ANIMADO_MAX_BYTES + 1,
        tipo: "image/gif",
      })).ok,
    ).toBe(false);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("assina um caminho NOVO da propria pessoa e monta a URL absoluta", async () => {
    fetchFalso.mockResolvedValue(
      Response.json({ url: "/object/upload/sign/avatars/users/u1/x.gif?token=abc" }),
    );
    const r = await autorizarEnvioDeAvatarAnimado("u1", { tamanho: 5_000_000, tipo: "image/gif" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.caminho).toMatch(/^users\/u1\/[0-9a-f]{32}\.gif$/);
      expect(r.urlDeEnvio).toBe(
        `${URL_BASE}/storage/v1/object/upload/sign/avatars/users/u1/x.gif?token=abc`,
      );
    }
    const [urlChamada] = fetchFalso.mock.calls[0]!;
    expect(String(urlChamada)).toContain("/storage/v1/object/upload/sign/avatars/users/u1/");
  });
});
