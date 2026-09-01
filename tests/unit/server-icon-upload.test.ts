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
    const result = await uploadUserAvatar("usuario-1", disfarcado, false);
    expect(result).toEqual({ ok: false, error: "Envie PNG, JPEG, WEBP ou GIF" });
  });

  it("recusa SVG", async () => {
    const svg = new File(
      [new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")],
      "foto.svg",
      { type: "image/svg+xml" },
    );
    const result = await uploadUserAvatar("usuario-1", svg, false);
    expect(result).toEqual({ ok: false, error: "Envie PNG, JPEG, WEBP ou GIF" });
  });

  /**
   * PNG DE VERDADE, e nao bytes zerados: com o teto passando a depender do
   * TIPO, o sniff precisa acontecer antes da conta de tamanho. Um arquivo
   * zerado agora e recusado por tipo, e o teste sobre tamanho nao provaria
   * mais nada sobre tamanho.
   */
  it("recusa PNG acima de 2MB", async () => {
    const bytes = new Uint8Array(SERVER_ICON_MAX_BYTES + 1);
    bytes.set(PNG_HEADER, 0);
    const big = new File([bytes], "grande.png", { type: "image/png" });
    const result = await uploadUserAvatar("usuario-1", big, false);
    expect(result).toEqual({ ok: false, error: "Imagem maior que 2MB" });
  });

  it("recusa arquivo vazio", async () => {
    const result = await uploadUserAvatar("usuario-1", fileOf([]), false);
    expect(result).toEqual({ ok: false, error: "Arquivo vazio" });
  });

  it("falha fechada sem configuracao, com mensagem propria", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const result = await uploadUserAvatar("usuario-1", fileOf(PNG_HEADER), false);
    expect(result).toEqual({
      ok: false,
      error: "Upload de foto nao configurado neste ambiente",
    });
  });
});

/**
 * MOVIMENTO — a trava que separa o avatar animado do Olimpo Pro.
 *
 * Este bloco existe por causa de um buraco que quase passou: travar apenas o
 * GIF deixaria WEBP e PNG livres, e os DOIS animam. Quem nao paga subiria um
 * WEBP animado como avatar e a exclusividade viraria enfeite — sem erro
 * nenhum, so o premium deixando de valer.
 *
 * A decisao e pelos BYTES, nunca pela extensao: e o mesmo principio do sniff
 * de tipo, e pela mesma razao (o cliente escolhe o nome e o Content-Type).
 */
describe("avatar animado — a trava e por bytes, nao por extensao", () => {
  /** "GIF89a" + o resto do cabecalho logico. */
  const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00];

  /** RIFF....WEBPVP8X + byte de flags. O bit 0x02 e o que liga a animacao. */
  function webp(flags: number) {
    const b = new Uint8Array(32);
    b.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    b.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    b.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
    b[20] = flags;
    return new File([b], "foto.webp", { type: "image/webp" });
  }

  /** PNG com o bloco `acTL` — que e exatamente o que torna um PNG um APNG. */
  function apng() {
    const cabeca = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const marca = [..."acTL"].map((c) => c.charCodeAt(0));
    return new File([new Uint8Array([...cabeca, 0, 0, 0, 8, ...marca])], "a.png", {
      type: "image/png",
    });
  }

  const RECUSA = { ok: false, error: "Avatar animado e exclusivo do Olimpo Pro" };

  it("GIF e recusado sem o plano", async () => {
    const r = await uploadUserAvatar("usuario-1", fileOf(GIF, "image/gif", "a.gif"), false);
    expect(r).toEqual(RECUSA);
  });

  it("GIF passa COM o plano", async () => {
    const r = await uploadUserAvatar("usuario-1", fileOf(GIF, "image/gif", "a.gif"), true);
    expect(r).not.toEqual(RECUSA);
  });

  /** O buraco: um WEBP animado nao pode entrar por ser "so um webp". */
  it("WEBP ANIMADO e recusado sem o plano", async () => {
    expect(await uploadUserAvatar("usuario-1", webp(0x02), false)).toEqual(RECUSA);
  });

  /** E o contrario tambem importa: WEBP normal nao pode virar exclusividade. */
  it("WEBP parado continua livre para todo mundo", async () => {
    expect(await uploadUserAvatar("usuario-1", webp(0x00), false)).not.toEqual(RECUSA);
  });

  it("APNG e recusado sem o plano", async () => {
    expect(await uploadUserAvatar("usuario-1", apng(), false)).toEqual(RECUSA);
  });

  it("PNG comum continua livre", async () => {
    const r = await uploadUserAvatar("usuario-1", fileOf(PNG_HEADER), false);
    expect(r).not.toEqual(RECUSA);
  });

  /**
   * O icone de servidor NAO herdou nada disto: ninguem pediu icone animado, e
   * ele aparece na barra lateral de todo mundo o tempo todo.
   */
  it("icone de servidor recusa GIF por TIPO, antes de falar em movimento", async () => {
    const r = await uploadServerIcon("s1", fileOf(GIF, "image/gif", "a.gif"));
    expect(r).toEqual({ ok: false, error: "Envie PNG, JPEG ou WEBP" });
  });
});
