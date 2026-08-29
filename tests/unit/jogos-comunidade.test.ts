import { describe, expect, it } from "vitest";
import { executavelSchema, normalizarExecutavel } from "@aether/shared";
// @ts-expect-error — modulo do desktop e JavaScript puro, sem tipos
import detect from "../../apps/desktop/src/game-detect.js";

/**
 * A biblioteca de jogos da comunidade.
 *
 * O que se testa aqui e a parte que decide: como um nome de executavel vira
 * chave, e o que recusamos receber. A fila em si mexe no banco e esta coberta
 * pela verificacao de integracao.
 */

describe("normalizacao do executavel", () => {
  it("tira extensao, caixa e pontuacao", () => {
    expect(normalizarExecutavel("VALORANT-Win64-Shipping.exe")).toBe(
      "valorantwin64shipping",
    );
    expect(normalizarExecutavel("hollow_knight.exe")).toBe("hollowknight");
    expect(normalizarExecutavel("GTA5.EXE")).toBe("gta5");
  });

  it("o mesmo programa escrito de formas diferentes vira a MESMA chave", () => {
    const formas = [
      "VALORANT-Win64-Shipping.exe",
      "valorant-win64-shipping.exe",
      "VALORANT Win64 Shipping",
      "VALORANT_Win64_Shipping.EXE",
    ];
    const chaves = new Set(formas.map(normalizarExecutavel));
    expect(chaves.size).toBe(1);
  });

  it("nao quebra com lixo", () => {
    expect(normalizarExecutavel("")).toBe("");
    expect(normalizarExecutavel("...")).toBe("");
  });
});

/**
 * A GUARDA MAIS IMPORTANTE DESTE ARQUIVO.
 *
 * O servidor normaliza para GRAVAR a sugestao; o desktop normaliza para CASAR
 * o processo com o catalogo. Se as duas divergirem, um jogo aprovado deixa de
 * casar com o processo que o originou — e o defeito e invisivel: nao ha erro,
 * o jogo simplesmente continua sem aparecer, exatamente como antes de alguem
 * se dar ao trabalho de sugerir.
 *
 * As duas implementacoes sao separadas de proposito (o desktop e JS puro e nao
 * importa `@aether/shared`), entao o que as mantem juntas e este teste.
 */
describe("as duas normalizacoes precisam concordar", () => {
  const CASOS = [
    "VALORANT-Win64-Shipping.exe",
    "VALORANT.exe",
    "FortniteClient-Win64-Shipping.exe",
    "hollow_knight.exe",
    "Riot Client.exe",
    "vgc.exe",
    "GTA5.EXE",
    "eu4.exe",
    "Cyberpunk2077.exe",
    "",
  ];

  it("servidor e desktop produzem a mesma chave", () => {
    for (const caso of CASOS) {
      expect(
        normalizarExecutavel(caso),
        `divergiram em "${caso}"`,
      ).toBe(detect.normalizarNomeDeJogo(caso));
    }
  });
});

/**
 * O que aceitamos receber.
 *
 * Isto vem do cliente, entra num banco COMPARTILHADO e volta para a tela de
 * todo mundo. As recusas aqui sao o que impede que a biblioteca vire deposito
 * de lixo — ou de dado pessoal.
 */
describe("o que recusamos receber", () => {
  const passa = (v: string) => executavelSchema.safeParse(v).success;

  it("aceita nome de executavel comum", () => {
    expect(passa("VALORANT-Win64-Shipping.exe")).toBe(true);
    expect(passa("hollow_knight.exe")).toBe(true);
    expect(passa("eu4.exe")).toBe(true);
  });

  /**
   * A RECUSA QUE MAIS IMPORTA: caminho jamais entra.
   *
   * O caminho carrega o nome de usuario do Windows quase sempre, e uma
   * biblioteca compartilhada o exporia para todo mundo, para sempre. Barra e
   * dois-pontos sao exatamente o que transforma nome de arquivo em caminho, e
   * recusa-los aqui e a garantia de que nao entra nem por acidente.
   */
  it("RECUSA caminho, nao so pede que nao mandem", () => {
    expect(passa("C:/Users/ryan/Games/jogo.exe")).toBe(false);
    expect(passa("C:\\Users\\ryan\\jogo.exe")).toBe(false);
    expect(passa("D:/Riot Games/VALORANT/live/x.exe")).toBe(false);
    expect(passa("/usr/bin/jogo")).toBe(false);
  });

  it("a mensagem de recusa de caminho explica o que fazer", () => {
    const r = executavelSchema.safeParse("C:/Users/ryan/jogo.exe");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toContain("caminho");
    }
  });

  it("recusa muito curto e muito longo", () => {
    expect(passa("a")).toBe(false);
    expect(passa("ab")).toBe(false);
    expect(passa("x".repeat(121))).toBe(false);
  });

  /**
   * Nome que SOBRA vazio depois de normalizar nao serve de chave: viraria a
   * mesma linha que qualquer outro lixo pontuado.
   */
  it("recusa o que normaliza para quase nada", () => {
    expect(passa("...")).toBe(false);
    expect(passa("-_-.exe")).toBe(false);
  });

  it("apara espaco em volta", () => {
    const r = executavelSchema.safeParse("  jogo.exe  ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("jogo.exe");
  });
});
