import { describe, expect, it } from "vitest";
import {
  nomeTwemoji,
  quebrarEmEmoji,
  temEmoji,
  urlTwemojiDeUnified,
} from "../../apps/web/src/lib/emoji/twemoji";

/**
 * As regras de nome do Twemoji sao chatas o bastante para travar: se um dia o
 * `fe0f` voltar a ser removido do jeito errado, o emoji some da tela sem erro
 * nenhum — so um `<img>` quebrado.
 */
describe("nomeTwemoji", () => {
  it("emoji simples: o proprio code point", () => {
    expect(nomeTwemoji("\u{1F525}")).toBe("1f525"); // fogo
  });

  it("remove o seletor de variacao fe0f quando NAO ha ZWJ", () => {
    expect(nomeTwemoji("❤️")).toBe("2764"); // coracao vermelho
  });

  it("keycap tambem perde o fe0f (nao e caso especial)", () => {
    expect(nomeTwemoji("#️⃣")).toBe("23-20e3");
  });

  it("mantem tudo, inclusive fe0f, quando ha ZWJ", () => {
    // familia: homem + ZWJ + mulher + ZWJ + menina
    expect(nomeTwemoji("\u{1F468}‍\u{1F469}‍\u{1F467}")).toBe(
      "1f468-200d-1f469-200d-1f467",
    );
  });

  it("bandeira: dois indicadores regionais", () => {
    expect(nomeTwemoji("\u{1F1E7}\u{1F1F7}")).toBe("1f1e7-1f1f7"); // BR
  });
});

describe("urlTwemojiDeUnified (formato do emoji-mart)", () => {
  it("aplica a mesma regra de fe0f", () => {
    expect(urlTwemojiDeUnified("2764-fe0f")).toBe("/twemoji/2764.svg");
    expect(urlTwemojiDeUnified("1f468-200d-1f469-200d-1f467")).toBe(
      "/twemoji/1f468-200d-1f469-200d-1f467.svg",
    );
  });
});

describe("quebrarEmEmoji", () => {
  it("separa texto de emoji preservando a ordem", () => {
    expect(quebrarEmEmoji("oi \u{1F525} tchau")).toEqual([
      { tipo: "texto", valor: "oi " },
      { tipo: "emoji", valor: "\u{1F525}" },
      { tipo: "texto", valor: " tchau" },
    ]);
  });

  it("texto sem emoji volta como um pedaco so", () => {
    expect(quebrarEmEmoji("nada aqui")).toEqual([
      { tipo: "texto", valor: "nada aqui" },
    ]);
  });

  it("emoji grudados viram pedacos separados", () => {
    const r = quebrarEmEmoji("\u{1F389}\u{1F386}");
    expect(r).toEqual([
      { tipo: "emoji", valor: "\u{1F389}" },
      { tipo: "emoji", valor: "\u{1F386}" },
    ]);
  });

  it("nao se perde entre duas chamadas (lastIndex resetado)", () => {
    quebrarEmEmoji("a \u{1F525} b");
    expect(quebrarEmEmoji("\u{1F525}")).toEqual([
      { tipo: "emoji", valor: "\u{1F525}" },
    ]);
  });
});

describe("temEmoji", () => {
  it("acha e nao acha", () => {
    expect(temEmoji("com \u{1F600}")).toBe(true);
    expect(temEmoji("sem nenhum")).toBe(false);
    // duas chamadas seguidas nao podem divergir por causa do lastIndex
    expect(temEmoji("com \u{1F600}")).toBe(true);
  });
});
