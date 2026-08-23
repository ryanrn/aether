import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BAN_DURATIONS,
  banExpiryFrom,
  inviteCodeSchema,
  messageContentSchema,
  permissionKeysSchema,
  safeGameIcon,
  userLimitSchema,
  usernameSchema,
} from "@aether/shared";

/**
 * Os schemas Zod sao a fronteira entre o que o cliente manda e o que o
 * servidor aceita. So entram aqui os que TRANSFORMAM ou decidem algo — schema
 * puramente declarativo nao ganha teste, porque o teste seria uma copia da
 * declaracao.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe("messageContentSchema", () => {
  it("apara espacos e recusa mensagem vazia", () => {
    expect(messageContentSchema.parse("  ola  ")).toBe("ola");
    expect(messageContentSchema.safeParse("").success).toBe(false);
    expect(messageContentSchema.safeParse("      ").success).toBe(false);
    expect(messageContentSchema.safeParse("\n\t ").success).toBe(false);
  });

  it("aceita exatamente 4000 e recusa 4001", () => {
    expect(messageContentSchema.safeParse("x".repeat(4000)).success).toBe(true);
    expect(messageContentSchema.safeParse("x".repeat(4001)).success).toBe(false);
  });

  it("apara ANTES de medir — espaco nao burla o limite", () => {
    const almost = `  ${"x".repeat(4000)}  `;
    expect(messageContentSchema.safeParse(almost).success).toBe(true);
  });
});

describe("usernameSchema", () => {
  it("aceita o conjunto documentado", () => {
    for (const valid of ["ryan", "jo_ao", "user.name", "a-b-c", "abc123"]) {
      expect(usernameSchema.safeParse(valid).success).toBe(true);
    }
  });

  it("recusa espaco, acento e simbolo", () => {
    for (const invalid of ["com espaco", "joão", "ryan!", "a@b", "<script>"]) {
      expect(usernameSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe("inviteCodeSchema", () => {
  it("aceita so alfanumerico no tamanho esperado", () => {
    expect(inviteCodeSchema.safeParse("AbC12345").success).toBe(true);
    expect(inviteCodeSchema.safeParse("abc-1234").success).toBe(false);
    expect(inviteCodeSchema.safeParse("curto").success).toBe(false);
  });
});

describe("userLimitSchema", () => {
  it("vazio vira null (ilimitado)", () => {
    expect(userLimitSchema.parse("")).toBeNull();
    expect(userLimitSchema.parse(null)).toBeNull();
  });

  it("converte texto de formulario em numero", () => {
    /** O valor chega de um <input>, entao string; o banco quer int. */
    expect(userLimitSchema.parse("5")).toBe(5);
  });

  it("recusa fora da faixa e fracionario", () => {
    for (const invalid of ["0", "100", "-1", "2.5"]) {
      expect(userLimitSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe("permissionKeysSchema", () => {
  it("recusa permissao inexistente", () => {
    /**
     * O formulario de cargos manda uma lista de chaves. Sem a lista fechada,
     * um cliente reescrito poderia inventar um nome e ver o que acontece do
     * outro lado.
     */
    expect(permissionKeysSchema.safeParse(["VIEW_CHANNEL"]).success).toBe(true);
    expect(permissionKeysSchema.safeParse(["ROOT"]).success).toBe(false);
    expect(
      permissionKeysSchema.safeParse(["VIEW_CHANNEL", "SUPER_ADMIN"]).success,
    ).toBe(false);
  });
});

describe("banExpiryFrom", () => {
  it("permanente nao tem vencimento", () => {
    expect(banExpiryFrom("permanent")).toBeNull();
  });

  it("calcula o vencimento a partir de agora", () => {
    vi.useFakeTimers();
    const now = new Date("2026-08-21T12:00:00Z");
    vi.setSystemTime(now);

    expect(banExpiryFrom("1d")?.toISOString()).toBe("2026-08-22T12:00:00.000Z");
    expect(banExpiryFrom("7d")?.toISOString()).toBe("2026-08-28T12:00:00.000Z");
    expect(banExpiryFrom("30d")?.toISOString()).toBe(
      "2026-09-20T12:00:00.000Z",
    );
  });

  it("toda duracao oferecida na interface e calculavel", () => {
    /**
     * Regressao para o descompasso: acrescentar uma opcao em BAN_DURATIONS sem
     * ensinar banExpiryFrom a converte-la viraria banimento permanente
     * silencioso.
     */
    for (const option of BAN_DURATIONS) {
      const expiry = banExpiryFrom(option.id);
      if (option.hours === null) expect(expiry).toBeNull();
      else expect(expiry).toBeInstanceOf(Date);
    }
  });
});

describe("safeGameIcon", () => {
  /**
   * Fronteira de seguranca, nao de formato: este icone vem do CLIENTE e e
   * renderizado como imagem na tela dos OUTROS. Aceitar errado aqui e o
   * caminho curto para XSS armazenado na presenca.
   */
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

  it("aceita data URL de imagem raster", () => {
    expect(safeGameIcon(png)).toBe(png);
    expect(safeGameIcon("data:image/jpeg;base64,/9j/4AAQ")).toBeTruthy();
    expect(safeGameIcon("data:image/webp;base64,UklGRg==")).toBeTruthy();
  });

  it("RECUSA SVG, mesmo sendo image/", () => {
    /**
     * O caso que motiva a funcao existir. SVG e documento: aceita <script> e
     * tem caminho de execucao quando renderizado. Nenhum icone precisa ser SVG.
     */
    expect(
      safeGameIcon("data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg=="),
    ).toBeNull();
    expect(
      safeGameIcon("data:image/svg+xml,<svg onload=alert(1)>"),
    ).toBeNull();
  });

  it("recusa qualquer coisa que nao seja data URL de imagem", () => {
    expect(safeGameIcon("javascript:alert(1)")).toBeNull();
    expect(safeGameIcon("https://exemplo.com/icone.png")).toBeNull();
    expect(safeGameIcon("data:text/html;base64,PGgxPg==")).toBeNull();
    expect(safeGameIcon("data:image/png,nao-e-base64")).toBeNull();
  });

  it("recusa base64 com caracteres fora do alfabeto", () => {
    // Sem isto, daria para embutir carga util depois de uma virgula.
    expect(safeGameIcon("data:image/png;base64,abc<>def")).toBeNull();
  });

  it("recusa icone grande demais", () => {
    // Presenca vai para a sala INTEIRA; imagem grande aqui e amplificada.
    const gigante = "data:image/png;base64," + "A".repeat(40000);
    expect(safeGameIcon(gigante)).toBeNull();
  });

  it("recusa o que nem string e", () => {
    expect(safeGameIcon(null)).toBeNull();
    expect(safeGameIcon(undefined)).toBeNull();
    expect(safeGameIcon("")).toBeNull();
    expect(safeGameIcon({ toString: () => png })).toBeNull();
  });
});
