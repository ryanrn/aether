import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SERVER_ICON_MAX_BYTES } from "@aether/shared";
import {
  uploadServerIcon,
  uploadUserAvatar,
} from "../../apps/web/src/server/storage";

/**
 * Upload de icone de servidor.
 *
 * O que se testa aqui e a parte que NAO depende de rede: as recusas. Todas
 * acontecem antes de qualquer chamada ao Supabase, entao a suite continua
 * offline e determinista.
 *
 * A recusa que mais importa e a de tipo: o `Content-Type` de um upload e
 * escolhido pelo CLIENTE, entao confiar nele deixaria passar um arquivo
 * qualquer renomeado para .png. Quem decide e o cabecalho real do arquivo.
 *
 * O caminho de sucesso (upload de fato indo ao Storage) nao e coberto: exigiria
 * a service_role key e uma chamada de rede real. Esta anotado nas limitacoes.
 */

const ORIGINAL_URL = process.env.SUPABASE_URL;
const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  // Configurado por padrao, para que as recusas testadas sejam as de
  // validacao — e nao "nao configurado" mascarando tudo.
  process.env.SUPABASE_URL = "https://exemplo.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-de-teste";
});

afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_URL;
  if (ORIGINAL_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
});

/** Monta um File com bytes crus, sem tocar no disco. */
function fileOf(bytes: number[], type = "image/png", name = "icone.png"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0];
const WEBP_HEADER = [
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
];

describe("uploadServerIcon — recusas de validacao", () => {
  it("recusa arquivo vazio", async () => {
    const result = await uploadServerIcon("servidor-1", fileOf([]));
    expect(result).toEqual({ ok: false, error: "Arquivo vazio" });
  });

  it("recusa arquivo acima de 2MB", async () => {
    const big = new File(
      [new Uint8Array(SERVER_ICON_MAX_BYTES + 1)],
      "grande.png",
      { type: "image/png" },
    );
    const result = await uploadServerIcon("servidor-1", big);
    expect(result).toEqual({ ok: false, error: "Imagem maior que 2MB" });
  });

  it("aceita exatamente o limite (o corte e MAIOR que, nao maior-ou-igual)", async () => {
    /**
     * Nao chega a subir: o proximo passo e o sniff, que reprova bytes zerados.
     * O que este teste fixa e que 2MB cravados NAO sao recusados pelo tamanho.
     */
    const exact = new File(
      [new Uint8Array(SERVER_ICON_MAX_BYTES)],
      "limite.png",
      { type: "image/png" },
    );
    const result = await uploadServerIcon("servidor-1", exact);
    expect(result).not.toEqual({ ok: false, error: "Imagem maior que 2MB" });
  });
});

describe("uploadServerIcon — o tipo vem dos BYTES, nao do que o cliente declara", () => {
  it("recusa arquivo que so finge ser imagem", async () => {
    /**
     * O caso real: um executavel ou script renomeado para .png, com
     * Content-Type "image/png" no formulario. Se confiassemos no cabecalho
     * declarado, ele entraria no bucket publico.
     */
    const disfarcado = fileOf(
      [0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00], // cabecalho de .exe
      "image/png",
      "virus.png",
    );
    const result = await uploadServerIcon("servidor-1", disfarcado);
    expect(result).toEqual({ ok: false, error: "Envie PNG, JPEG ou WEBP" });
  });

  it("recusa SVG, mesmo declarado como imagem", async () => {
    /**
     * SVG e um formato de imagem, mas carrega script — servido de um bucket
     * publico vira XSS. Fica de fora da lista de proposito.
     */
    const svg = new File(
      [new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
      "icone.svg",
      { type: "image/svg+xml" },
    );
    const result = await uploadServerIcon("servidor-1", svg);
    expect(result).toEqual({ ok: false, error: "Envie PNG, JPEG ou WEBP" });
  });

  it("recusa arquivo curto demais para ter cabecalho", async () => {
    const result = await uploadServerIcon("servidor-1", fileOf([0x89, 0x50]));
    expect(result).toEqual({ ok: false, error: "Envie PNG, JPEG ou WEBP" });
  });

  it("reconhece PNG, JPEG e WEBP pelos bytes", async () => {
    /**
     * Sem credencial real, o upload nao completa — mas os tres precisam
     * PASSAR do sniff. Se falhassem ali, o erro seria "Envie PNG, JPEG ou
     * WEBP", e nao a falha de rede/credencial que esperamos.
     */
    for (const [header, type] of [
      [PNG_HEADER, "image/png"],
      [JPEG_HEADER, "image/jpeg"],
      [WEBP_HEADER, "image/webp"],
    ] as const) {
      const result = await uploadServerIcon("servidor-1", fileOf([...header], type));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).not.toBe("Envie PNG, JPEG ou WEBP");
      }
    }
  });
});

describe("uploadServerIcon — falha fechada sem configuracao", () => {
  it("recusa quando falta a service_role key", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const result = await uploadServerIcon("servidor-1", fileOf(PNG_HEADER));
    expect(result).toEqual({
      ok: false,
      error: "Upload de icone nao configurado neste ambiente",
    });
  });

  it("recusa quando falta a URL do projeto", async () => {
    delete process.env.SUPABASE_URL;
    const result = await uploadServerIcon("servidor-1", fileOf(PNG_HEADER));
    expect(result.ok).toBe(false);
  });

  it("checa a configuracao ANTES de ler o arquivo inteiro na memoria", async () => {
    /**
     * Ordem importa: um upload de 2MB em ambiente sem credencial nao deve
     * virar 2MB de buffer so para ser recusado no fim.
     */
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const big = new File([new Uint8Array(SERVER_ICON_MAX_BYTES)], "grande.png", {
      type: "image/png",
    });
    const result = await uploadServerIcon("servidor-1", big);
    expect(result).toEqual({
      ok: false,
      error: "Upload de icone nao configurado neste ambiente",
    });
  });
});

describe("uploadUserAvatar — mesma porta, mesmas recusas", () => {
  /**
   * Icone de servidor e foto de perfil passam pelo MESMO caminho de upload,
   * de proposito: duas copias da validacao divergiriam, e bastaria uma delas
   * esquecer o sniff de bytes para o bucket publico passar a aceitar arquivo
   * disfarcado. Estes testes existem para provar que a foto de perfil nao
   * ganhou um caminho mais frouxo.
   */
  it("recusa arquivo que so finge ser imagem", async () => {
    const disfarcado = fileOf(
      [0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00],
      "image/png",
      "virus.png",
    );
    const result = await uploadUserAvatar("usuario-1", disfarcado);
    expect(result).toEqual({ ok: false, error: "Envie PNG, JPEG ou WEBP" });
  });

  it("recusa SVG", async () => {
    const svg = new File(
      [new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")],
      "foto.svg",
      { type: "image/svg+xml" },
    );
    const result = await uploadUserAvatar("usuario-1", svg);
    expect(result).toEqual({ ok: false, error: "Envie PNG, JPEG ou WEBP" });
  });

  it("recusa acima de 2MB", async () => {
    const big = new File([new Uint8Array(SERVER_ICON_MAX_BYTES + 1)], "grande.png", {
      type: "image/png",
    });
    const result = await uploadUserAvatar("usuario-1", big);
    expect(result).toEqual({ ok: false, error: "Imagem maior que 2MB" });
  });

  it("recusa arquivo vazio", async () => {
    const result = await uploadUserAvatar("usuario-1", fileOf([]));
    expect(result).toEqual({ ok: false, error: "Arquivo vazio" });
  });

  it("falha fechada sem configuracao, com mensagem propria", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const result = await uploadUserAvatar("usuario-1", fileOf(PNG_HEADER));
    expect(result).toEqual({
      ok: false,
      error: "Upload de foto nao configurado neste ambiente",
    });
  });
});
