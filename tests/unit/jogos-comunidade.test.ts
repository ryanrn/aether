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

/**
 * O catalogo da comunidade dentro do desktop.
 *
 * Cobre o que decide, sem tocar no sistema: como uma lista aprovada vira
 * casamento, e o que entra na lista de candidatos a sugestao.
 */
describe("o catalogo da comunidade no desktop", () => {
  const COMUNIDADE = [
    { chave: "sotwin64shipping", nome: "Sea of Thieves" },
    { chave: "ballatro", nome: "Ballatro" },
  ];

  it("casa o executavel aprovado com o nome do jogo", () => {
    const achados = detect.jogosDaComunidadeEm(
      "explorer.exe\nSoT-Win64-Shipping.exe\nchrome.exe",
      COMUNIDADE,
    );
    expect(achados.map((j: { nome: string }) => j.nome)).toEqual(["Sea of Thieves"]);
  });

  /**
   * IGUALDADE EXATA, e nao prefixo como no catalogo das lojas.
   *
   * A diferenca tem razao: na loja a chave e o NOME DO JOGO, e o executavel
   * costuma ser o nome mais um sufixo de motor. Aqui a chave JA E o executavel,
   * entao aceitar prefixo faria `sot` casar com qualquer `sotqualquercoisa.exe`
   * que a pessoa tivesse aberto.
   */
  it("NAO casa por prefixo", () => {
    expect(
      detect.jogosDaComunidadeEm("SoT-Win64-Shipping-Beta.exe", COMUNIDADE),
    ).toEqual([]);
    expect(detect.jogosDaComunidadeEm("ballatro2.exe", COMUNIDADE)).toEqual([]);
  });

  it("nao repete quando o mesmo jogo tem varios processos", () => {
    const achados = detect.jogosDaComunidadeEm(
      "ballatro.exe\nBallatro.EXE\nBallatro.exe",
      COMUNIDADE,
    );
    expect(achados).toHaveLength(1);
  });

  it("catalogo vazio nao acha nada, e nao quebra", () => {
    expect(detect.jogosDaComunidadeEm("qualquer.exe", [])).toEqual([]);
    expect(detect.jogosDaComunidadeEm("", COMUNIDADE)).toEqual([]);
  });

  it("a lista trocada substitui a anterior por inteiro", () => {
    detect.definirCatalogoDaComunidade(COMUNIDADE);
    expect(detect.lerCatalogoDaComunidade()).toHaveLength(2);
    detect.definirCatalogoDaComunidade([]);
    expect(detect.lerCatalogoDaComunidade()).toHaveLength(0);
  });

  it("ignora entrada malformada em vez de quebrar", () => {
    const n = detect.definirCatalogoDaComunidade([
      { chave: "ok", nome: "Ok" },
      { chave: 123 },
      null,
      "lixo",
    ]);
    expect(n).toBe(1);
  });
});

/**
 * A lista de candidatos a sugestao.
 *
 * E a UNICA porta pela qual nomes de processo chegam a pagina. O que ela nao
 * filtra, a pessoa le — entao o que importa aqui e nao esconder o jogo que ela
 * veio sugerir, e nao abrir com trinta processos do Windows.
 */
describe("candidatos a sugestao", () => {
  const PROCESSOS = [
    "Name",
    "System",
    "svchost.exe",
    "explorer.exe",
    "dwm.exe",
    "chrome.exe",
    "Ballatro.exe",
    "MeuJogoIndie.exe",
    "VALORANT-Win64-Shipping.exe",
  ].join("\n");

  const CATALOGO_DE_LOJA = [
    { pasta: "d:/riot games/valorant/live/", nome: "VALORANT", launch: null, icone: null },
  ];

  it("descarta ruido conhecido do sistema", () => {
    const c = detect.candidatosParaSugerir(PROCESSOS, [], []);
    for (const lixo of ["System", "svchost.exe", "explorer.exe", "dwm.exe"]) {
      expect(c).not.toContain(lixo);
    }
  });

  it("descarta o cabecalho da saida do wmic", () => {
    expect(detect.candidatosParaSugerir(PROCESSOS, [], [])).not.toContain("Name");
  });

  /** Nao ha o que sugerir sobre um jogo que a loja ja declarou. */
  it("descarta o que o catalogo da LOJA ja reconhece", () => {
    const c = detect.candidatosParaSugerir(PROCESSOS, CATALOGO_DE_LOJA, []);
    expect(c).not.toContain("VALORANT-Win64-Shipping.exe");
  });

  /** Nem sobre um que a comunidade ja aprovou. */
  it("descarta o que a COMUNIDADE ja reconhece", () => {
    const c = detect.candidatosParaSugerir(PROCESSOS, [], [
      { chave: "ballatro", nome: "Ballatro" },
    ]);
    expect(c).not.toContain("Ballatro.exe");
  });

  /** O que a pessoa veio sugerir precisa sobreviver a todos os filtros. */
  it("MANTEM o jogo desconhecido, que e o motivo da tela existir", () => {
    const c = detect.candidatosParaSugerir(PROCESSOS, CATALOGO_DE_LOJA, []);
    expect(c).toContain("MeuJogoIndie.exe");
  });

  it("nao repete o mesmo programa", () => {
    const c = detect.candidatosParaSugerir("jogo.exe\nJOGO.EXE\njogo.exe", [], []);
    expect(c).toEqual(["jogo.exe"]);
  });

  it("vem em ordem, para a lista nao dancar entre aberturas", () => {
    const c = detect.candidatosParaSugerir("zeta.exe\nalfa.exe\nmeio.exe", [], []);
    expect(c).toEqual(["alfa.exe", "meio.exe", "zeta.exe"]);
  });
});
