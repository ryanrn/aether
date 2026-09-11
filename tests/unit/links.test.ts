import { describe, expect, it } from "vitest";
import { quebrarEmLink, temLink } from "../../apps/web/src/lib/links";

/**
 * `quebrarEmLink` decide o que vira `<a>` numa mensagem de chat. Errar pra
 * mais e um link executavel (`javascript:...`); errar pra menos e o link
 * carregar pontuacao de frase ou o fechamento de um parenteses que nao e dele.
 */
describe("temLink", () => {
  it("verdadeiro com http/https no meio do texto", () => {
    expect(temLink("veja isso: https://youtu.be/abc123")).toBe(true);
  });

  it("falso sem link nenhum", () => {
    expect(temLink("oi, tudo bem?")).toBe(false);
  });

  it("falso para esquemas nao-http (javascript:, data:)", () => {
    expect(temLink("javascript:alert(1)")).toBe(false);
    expect(temLink("data:text/html,oi")).toBe(false);
  });
});

describe("quebrarEmLink", () => {
  it("texto sem link -> um pedaco so, tipo texto", () => {
    expect(quebrarEmLink("oi, tudo bem?")).toEqual([
      { tipo: "texto", valor: "oi, tudo bem?" },
    ]);
  });

  it("link sozinho -> um pedaco so, tipo link", () => {
    expect(quebrarEmLink("https://youtu.be/abc123")).toEqual([
      { tipo: "link", valor: "https://youtu.be/abc123" },
    ]);
  });

  it("link no meio do texto -> tres pedacos", () => {
    expect(quebrarEmLink("veja https://youtu.be/abc123 depois")).toEqual([
      { tipo: "texto", valor: "veja " },
      { tipo: "link", valor: "https://youtu.be/abc123" },
      { tipo: "texto", valor: " depois" },
    ]);
  });

  it("tira pontuacao de frase colada no fim", () => {
    expect(quebrarEmLink("olha isso: https://x.com/a.")).toEqual([
      { tipo: "texto", valor: "olha isso: " },
      { tipo: "link", valor: "https://x.com/a" },
      { tipo: "texto", valor: "." },
    ]);
  });

  it("nao inclui o ) que fechou um parenteses de FORA do link", () => {
    expect(quebrarEmLink("(veja https://x.com/a)")).toEqual([
      { tipo: "texto", valor: "(veja " },
      { tipo: "link", valor: "https://x.com/a" },
      { tipo: "texto", valor: ")" },
    ]);
  });

  it("mantem o ) quando ele E parte do link", () => {
    const url = "https://pt.wikipedia.org/wiki/Rio_(homonimo)";
    expect(quebrarEmLink(url)).toEqual([{ tipo: "link", valor: url }]);
  });

  it("dois links na mesma mensagem", () => {
    expect(quebrarEmLink("https://a.com e https://b.com")).toEqual([
      { tipo: "link", valor: "https://a.com" },
      { tipo: "texto", valor: " e " },
      { tipo: "link", valor: "https://b.com" },
    ]);
  });

  it("nunca gera pedaco de link para javascript:", () => {
    const pedacos = quebrarEmLink("clique: javascript:alert(1)");
    expect(pedacos.every((p) => p.tipo === "texto")).toBe(true);
  });
});
