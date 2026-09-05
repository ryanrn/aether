import { describe, expect, it, vi } from "vitest";

/**
 * O provedor lido do endereco (`/api/conexoes/twitch/...`).
 *
 * POR QUE TEM TESTE: esse valor vem da URL e termina numa coluna de enum e
 * numa chave de busca. A tentacao e `bruto.toUpperCase()`, que aceita
 * qualquer texto e empurra o problema para o banco. A lista fechada e a
 * defesa, e este teste e o que impede alguem de "simplificar" ela depois.
 */

// O `lerProvedor` consulta o registro para recusar provedor previsto mas
// ainda sem adaptador. Aqui so o SPOTIFY existe, como em producao hoje.
vi.mock("@aether/access", () => ({
  provedor: (id: string) => (id === "SPOTIFY" ? { id, nome: "Spotify" } : null),
}));

const { lerProvedor } = await import("@/server/conexoes/provedor-da-url");

describe("lerProvedor", () => {
  it("aceita o nome minusculo do provedor implementado", () => {
    expect(lerProvedor("spotify")).toBe("SPOTIFY");
  });

  it("nao liga para caixa alta ou baixa", () => {
    expect(lerProvedor("SpOtIfY")).toBe("SPOTIFY");
  });

  it("previsto no enum mas SEM adaptador ainda e 404, nao erro", () => {
    // Estao no enum do banco, mas `provedor()` devolve null para eles.
    expect(lerProvedor("twitch")).toBeNull();
    expect(lerProvedor("steam")).toBeNull();
    expect(lerProvedor("riot")).toBeNull();
  });

  it("recusa qualquer coisa fora da lista", () => {
    for (const ruim of [
      "",
      "SPOTIFY; DROP TABLE",
      "../spotify",
      "spotify ",
      "__proto__",
      "constructor",
      "toString",
    ]) {
      expect(lerProvedor(ruim)).toBeNull();
    }
  });
});
