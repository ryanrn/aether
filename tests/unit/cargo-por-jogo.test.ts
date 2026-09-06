import { describe, expect, it } from "vitest";
import {
  Permission,
  PERMISSOES_DE_CARGO_DE_JOGO,
  combine,
  has,
  normalizarNome,
  permissoesDeCargoDeJogo,
} from "@aether/shared";
import { diffDeCargos } from "../../apps/realtime/src/games/diff-de-cargos";

/**
 * Cargo automatico por jogo (fase 2, estagio 2).
 *
 * Duas coisas se testam aqui sem banco:
 *  - o clamp de permissao, que e a defesa contra "abrir um jogo" virar um
 *    caminho para ganhar poder de moderacao;
 *  - o diff, que e o coracao da sincronizacao e o tipo de logica que erra em
 *    silencio.
 */

describe("permissoesDeCargoDeJogo — o clamp", () => {
  it("mantem so permissao de participacao", () => {
    for (const key of [
      "VIEW_CHANNEL",
      "CONNECT",
      "SPEAK",
      "SCREEN_SHARE",
      "CAMERA",
      "SEND_MESSAGES",
    ] as const) {
      expect(has(PERMISSOES_DE_CARGO_DE_JOGO, key)).toBe(true);
    }
  });

  it("corta moderacao, gerencia e convite mesmo se o cargo ja tinha", () => {
    const perigoso = combine(
      "VIEW_CHANNEL",
      "BAN_MEMBERS",
      "KICK_MEMBERS",
      "MANAGE_ROLES",
      "MANAGE_SERVER",
      "ADMINISTRATOR",
      "CREATE_INVITE",
      "MOVE_MEMBERS",
    );
    const limpo = permissoesDeCargoDeJogo(perigoso);

    expect(has(limpo, "VIEW_CHANNEL")).toBe(true);
    for (const key of [
      "BAN_MEMBERS",
      "KICK_MEMBERS",
      "MANAGE_ROLES",
      "MANAGE_SERVER",
      "ADMINISTRATOR",
      "CREATE_INVITE",
      "MOVE_MEMBERS",
    ] as const) {
      expect(has(limpo, key)).toBe(false);
    }
  });

  it("ADMINISTRATOR nao vaza pelo atalho do has()", () => {
    // has() devolve true para qualquer chave quando ADMINISTRATOR esta ligado;
    // o clamp precisa remover o BIT, nao so 'esconder' as consequencias.
    const limpo = permissoesDeCargoDeJogo(combine("ADMINISTRATOR"));
    expect((limpo & Permission.ADMINISTRATOR) === 0n).toBe(true);
    expect(has(limpo, "VIEW_CHANNEL")).toBe(false);
  });

  it("e idempotente", () => {
    const uma = permissoesDeCargoDeJogo(combine("SPEAK", "BAN_MEMBERS"));
    expect(permissoesDeCargoDeJogo(uma)).toBe(uma);
  });
});

describe("normalizarNome — a mesma dos dois lados", () => {
  it("casa grafias do mesmo jogo", () => {
    expect(normalizarNome("Counter-Strike 2")).toBe(
      normalizarNome("COUNTER-STRIKE 2"),
    );
    expect(normalizarNome("Marvel's Spider-Man")).toBe("marvels spider man");
  });

  it("mantem digitos — sequencia e outro jogo", () => {
    expect(normalizarNome("Portal 2")).not.toBe(normalizarNome("Portal"));
  });

  it("aceita entrada vazia sem quebrar", () => {
    expect(normalizarNome("")).toBe("");
    expect(normalizarNome("   ")).toBe("");
  });
});

describe("diffDeCargos", () => {
  it("adiciona o alvo que falta e remove o que sobra", () => {
    expect(diffDeCargos(["a", "b"], ["b", "c"])).toEqual({
      aAdicionar: ["c"],
      aRemover: ["a"],
    });
  });

  it("alvo vazio remove tudo (jogo fechou / recurso desligado)", () => {
    expect(diffDeCargos(["a", "b"], [])).toEqual({
      aAdicionar: [],
      aRemover: ["a", "b"],
    });
  });

  it("nada a fazer quando ja bate", () => {
    expect(diffDeCargos(["a"], ["a"])).toEqual({
      aAdicionar: [],
      aRemover: [],
    });
  });

  it("ignora duplicatas na entrada", () => {
    expect(diffDeCargos(["a", "a"], ["a", "a"])).toEqual({
      aAdicionar: [],
      aRemover: [],
    });
  });
});
