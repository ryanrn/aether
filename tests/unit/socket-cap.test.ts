import { describe, expect, it } from "vitest";
import { socketsAcimaDoTeto } from "../../apps/realtime/src/socket-cap";

/**
 * Teto de conexoes por usuario (parte pura).
 *
 * A propriedade que estes testes travam: a funcao NUNCA devolve o socket
 * atual, e devolve exatamente o excedente. Um erro para qualquer lado e ruim —
 * devolver o atual derruba quem acabou de entrar (laco de reconexao infinito);
 * devolver de menos deixa o teto passar batido.
 */

describe("socketsAcimaDoTeto", () => {
  it("lista dentro do teto: nada a expulsar", () => {
    expect(socketsAcimaDoTeto(["a", "b", "c"], "c", 8)).toEqual([]);
    expect(socketsAcimaDoTeto(["a", "b", "c", "d", "e", "f", "g", "h"], "h", 8)).toEqual([]);
  });

  it("um acima do teto: expulsa exatamente um, e nao o atual", () => {
    const fora = socketsAcimaDoTeto(["v1", "v2", "v3", "atual"], "atual", 3);
    expect(fora).toHaveLength(1);
    expect(fora).not.toContain("atual");
    expect(fora[0]).toBe("v1");
  });

  it("varios acima do teto: expulsa todo o excedente", () => {
    const todos = ["a", "b", "c", "d", "e", "atual"];
    const fora = socketsAcimaDoTeto(todos, "atual", 2);
    // 6 sockets, teto 2 -> 4 a expulsar, nunca o atual
    expect(fora).toHaveLength(4);
    expect(fora).not.toContain("atual");
    expect(fora).toEqual(["a", "b", "c", "d"]);
  });

  it("teto 0 desliga a checagem", () => {
    expect(socketsAcimaDoTeto(["a", "b", "c", "d"], "d", 0)).toEqual([]);
  });

  it("teto negativo tambem nao expulsa ninguem", () => {
    expect(socketsAcimaDoTeto(["a", "b"], "b", -1)).toEqual([]);
  });

  it("o socket atual pode nem estar na lista ainda (corrida) — ainda assim nao some do resultado", () => {
    /**
     * Se `attachSocket` e `socketIdsOf` correrem, a lista pode nao conter o
     * atual. O excedente sai dos outros do mesmo jeito, e o atual continua de
     * fora do resultado porque nunca esteve na lista.
     */
    const fora = socketsAcimaDoTeto(["v1", "v2", "v3"], "atual", 2);
    expect(fora).toEqual(["v1"]);
    expect(fora).not.toContain("atual");
  });

  it("nao muta a lista recebida", () => {
    const original = ["a", "b", "c", "d"];
    const copia = [...original];
    socketsAcimaDoTeto(original, "d", 2);
    expect(original).toEqual(copia);
  });
});
