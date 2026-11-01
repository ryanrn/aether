import { describe, expect, it } from "vitest";
import {
  mencoesPedidas,
  nomesDigitados,
  quebrarEmMencoes,
  textoComNomes,
  trocarNomesPorMarcadores,
} from "@aether/shared";
import {
  aplicarSugestao,
  consultaNoCursor,
  filtrarSugestoes,
} from "@/lib/chat/autocompletar-mencao";

/**
 * Leitura de mencoes no texto (P1-2) — a regra que gateway e tela dividem, e
 * o autocompletar do campo.
 */

const ID = "ckabcdefgh1234567890";
const CARGO = "ckcargo00000000000001";

describe("quebrarEmMencoes", () => {
  it("separa marcador de pessoa, de cargo e @everyone", () => {
    expect(quebrarEmMencoes(`oi <@${ID}> e <@&${CARGO}>, @everyone!`)).toEqual([
      { tipo: "texto", valor: "oi " },
      { tipo: "usuario", id: ID },
      { tipo: "texto", valor: " e " },
      { tipo: "cargo", id: CARGO },
      { tipo: "texto", valor: ", " },
      { tipo: "todos" },
      { tipo: "texto", valor: "!" },
    ]);
  });

  it("dentro de codigo nao ha mencao", () => {
    const texto = "use `@everyone` e ```\n<@" + ID + ">\n```";
    expect(quebrarEmMencoes(texto)).toEqual([{ tipo: "texto", valor: texto }]);
  });

  it("@everyone colado em palavra ou e-mail nao conta", () => {
    expect(mencoesPedidas("x@everyone.com e a@everyone").todos).toBe(false);
  });
});

describe("nomesDigitados", () => {
  it("acha @nome, ignora e-mail, codigo e ponto final", () => {
    expect(nomesDigitados("fala @Ryan. e @joao_1, mail a@b.com, `@nao`")).toEqual([
      "ryan",
      "joao_1",
    ]);
  });

  it("@everyone nao e nome de usuario", () => {
    expect(nomesDigitados("@everyone")).toEqual([]);
  });
});

describe("trocarNomesPorMarcadores", () => {
  it("troca so os nomes resolvidos e devolve a pontuacao cortada", () => {
    expect(
      trocarNomesPorMarcadores("oi @Ryan. e @fulano", { ryan: ID }),
    ).toBe(`oi <@${ID}>. e @fulano`);
  });

  it("nao mexe dentro de codigo", () => {
    expect(trocarNomesPorMarcadores("`@ryan`", { ryan: ID })).toBe("`@ryan`");
  });
});

describe("textoComNomes", () => {
  it("marcador vira @Nome; desconhecido vira neutro", () => {
    const mencoes = {
      usuarios: [{ id: ID, nome: "Ryan" }],
      cargos: [],
      todos: false,
    };
    expect(textoComNomes(`<@${ID}> e <@outro00000000>`, mencoes)).toBe(
      "@Ryan e @alguém",
    );
  });
});

describe("autocompletar", () => {
  const pessoas = [
    { id: "1", username: "joao", nome: "João Silva", avatarUrl: null },
    { id: "2", username: "maria", nome: "Maria Joana", avatarUrl: null },
    { id: "3", username: "ryan", nome: "Ryan", avatarUrl: null },
  ];

  it("abre no @ depois de espaco, nao no meio de e-mail", () => {
    expect(consultaNoCursor("oi @jo", 6)).toEqual({ inicio: 3, termo: "jo" });
    expect(consultaNoCursor("a@jo", 4)).toBeNull();
    expect(consultaNoCursor("@", 1)).toEqual({ inicio: 0, termo: "" });
  });

  it("usuario que comeca vem antes de nome que contem; sem acento", () => {
    const r = filtrarSugestoes("jo", pessoas, false);
    expect(r.map((s) => (s.tipo === "pessoa" ? s.pessoa.id : "todos"))).toEqual(["1", "2"]);
    expect(filtrarSugestoes("joao", pessoas, false)).toHaveLength(1);
  });

  it("@everyone so quando permitido e o termo e prefixo", () => {
    expect(filtrarSugestoes("ev", pessoas, true)).toEqual([{ tipo: "todos" }]);
    expect(filtrarSugestoes("ev", pessoas, false)).toEqual([]);
  });

  it("aplica a escolha no lugar do termo e poe o cursor depois", () => {
    const texto = "oi @jo tudo bem";
    const r = aplicarSugestao(texto, { inicio: 3, termo: "jo" }, 6, {
      tipo: "pessoa",
      pessoa: pessoas[0]!,
    });
    expect(r).toEqual({ texto: "oi @joao  tudo bem", cursor: 9 });
  });
});
