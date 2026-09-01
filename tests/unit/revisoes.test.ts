import { describe, expect, it } from "vitest";
import { rotuloDeRevisoes, totalDeRevisoes } from "@aether/shared";

/**
 * O numerinho da engrenagem.
 *
 * Parece pequeno demais para ter teste, mas o que ele conta e o que decide se
 * um pedido de vitrine fica dias parado sem ninguem saber. Duas coisas podem
 * dar errado em silencio: somar so uma das filas (o marcador ficaria limpo com
 * coisa esperando na outra) e o teto de digitos.
 */

describe("totalDeRevisoes", () => {
  it("soma as DUAS filas", () => {
    expect(totalDeRevisoes({ jogos: 2, comunidades: 3 })).toBe(5);
  });

  it("conta a fila de comunidades mesmo sem jogo nenhum", () => {
    // O caso que motivou tudo: um pedido de vitrine esperando, zero jogos.
    expect(totalDeRevisoes({ jogos: 0, comunidades: 1 })).toBe(1);
  });

  it("conta a fila de jogos mesmo sem pedido de vitrine", () => {
    expect(totalDeRevisoes({ jogos: 1, comunidades: 0 })).toBe(1);
  });

  it("trata 'ainda nao sei' como zero, e nao como erro", () => {
    // Antes da primeira resposta o estado e `null`: nao desenha marcador.
    expect(totalDeRevisoes(null)).toBe(0);
    expect(totalDeRevisoes(undefined)).toBe(0);
  });

  it("da zero com as duas filas vazias", () => {
    expect(totalDeRevisoes({ jogos: 0, comunidades: 0 })).toBe(0);
  });
});

describe("rotuloDeRevisoes", () => {
  it("mostra o numero exato ate nove", () => {
    expect(rotuloDeRevisoes(1)).toBe("1");
    expect(rotuloDeRevisoes(9)).toBe("9");
  });

  it("vira '9+' a partir de dez", () => {
    // A fronteira: 9 cabe no marcador de 14px, 10 ja seriam dois digitos.
    expect(rotuloDeRevisoes(10)).toBe("9+");
    expect(rotuloDeRevisoes(137)).toBe("9+");
  });
});
