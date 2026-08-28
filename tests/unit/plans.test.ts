import { describe, expect, it } from "vitest";
import {
  PLANS,
  alturaExcedeOPlano,
  limitesDoPlano,
  planoAtende,
  planoEfetivo,
  type PlanTier,
} from "@aether/shared";

/**
 * Planos — a parte que decide o que alguem pagou para receber.
 *
 * Vale teste porque os dois erros classicos aqui sao silenciosos e caros:
 * comparar plano por igualdade (o que esquece o plano de cima) e deixar uma
 * assinatura vencida continuar valendo. Nenhum dos dois aparece como
 * excecao — o primeiro tira do cliente o que ele comprou, o segundo da de
 * graca o que ele deixou de pagar.
 */

describe("a escada de planos", () => {
  it("cada plano atende a si mesmo", () => {
    for (const tier of ["FREE", "PLUS", "PRO"] as PlanTier[]) {
      expect(planoAtende(tier, tier)).toBe(true);
    }
  });

  it("plano de cima atende ao pedido do de baixo", () => {
    expect(planoAtende("PRO", "PLUS")).toBe(true);
    expect(planoAtende("PRO", "FREE")).toBe(true);
    expect(planoAtende("PLUS", "FREE")).toBe(true);
  });

  it("plano de baixo NAO atende ao de cima", () => {
    expect(planoAtende("FREE", "PLUS")).toBe(false);
    expect(planoAtende("FREE", "PRO")).toBe(false);
    expect(planoAtende("PLUS", "PRO")).toBe(false);
  });

  /**
   * O caso que motivou existir uma funcao em vez de `===` espalhado: quem
   * assina o plano mais caro tem de passar em toda porta que pede o mais
   * barato. Escrito com igualdade, o PRO seria barrado numa porta de PLUS.
   */
  it("quem paga MAIS nunca recebe menos", () => {
    expect(planoAtende("PRO", "PLUS")).toBe(true);
    expect(PLANS.PRO.uploadMaxBytes).toBeGreaterThan(PLANS.PLUS.uploadMaxBytes);
    expect(PLANS.PLUS.uploadMaxBytes).toBeGreaterThan(PLANS.FREE.uploadMaxBytes);
    expect(PLANS.PRO.bitrateMax).toBeGreaterThan(PLANS.PLUS.bitrateMax);
    expect(PLANS.PLUS.bitrateMax).toBeGreaterThan(PLANS.FREE.bitrateMax);
  });
});

describe("plano efetivo — o vencimento vale na leitura", () => {
  const ONTEM = new Date("2026-08-01T00:00:00Z");
  const HOJE = new Date("2026-08-15T00:00:00Z");
  const AMANHA = new Date("2026-09-01T00:00:00Z");

  it("sem assinatura, e gratuito", () => {
    expect(planoEfetivo(null, HOJE)).toBe("FREE");
    expect(planoEfetivo(undefined, HOJE)).toBe("FREE");
  });

  it("assinatura no prazo vale", () => {
    expect(planoEfetivo({ tier: "PLUS", expiraEm: AMANHA }, HOJE)).toBe("PLUS");
  });

  /**
   * O que um job de vencimento erraria: aqui a conta expira sozinha, no
   * segundo exato, mesmo com o resto do sistema parado.
   */
  it("assinatura VENCIDA cai para gratuito, sem ninguem mexer na linha", () => {
    expect(planoEfetivo({ tier: "PRO", expiraEm: ONTEM }, HOJE)).toBe("FREE");
  });

  it("o instante do vencimento ja NAO vale", () => {
    expect(planoEfetivo({ tier: "PLUS", expiraEm: HOJE }, HOJE)).toBe("FREE");
  });

  /** Concessao a mao (equipe, teste, cortesia) nao vira abobora sozinha. */
  it("sem validade, vale para sempre", () => {
    expect(planoEfetivo({ tier: "PRO", expiraEm: null }, HOJE)).toBe("PRO");
  });

  it("aceita data em texto, como vem de JSON", () => {
    expect(
      planoEfetivo({ tier: "PLUS", expiraEm: AMANHA.toISOString() }, HOJE),
    ).toBe("PLUS");
  });

  /**
   * Data ilegivel cai para GRATUITO, e nao para o tier guardado.
   *
   * A escolha e deliberada: diante de dado corrompido, errar para menos custa
   * um cliente reclamando; errar para mais entrega de graca e ninguem avisa.
   */
  it("data invalida cai para gratuito", () => {
    expect(planoEfetivo({ tier: "PRO", expiraEm: "nao-e-data" }, HOJE)).toBe(
      "FREE",
    );
  });
});

describe("limites", () => {
  it("plano desconhecido cai no gratuito, sem lancar", () => {
    expect(limitesDoPlano(null).tier).toBe("FREE");
    expect(limitesDoPlano(undefined).tier).toBe("FREE");
    expect(limitesDoPlano("INVENTADO" as PlanTier).tier).toBe("FREE");
  });

  it("os numeros pedidos para a tela estao na tabela", () => {
    expect(PLANS.FREE.alturaMax).toBe(720);
    expect(PLANS.FREE.quadrosMax).toBe(30);
    expect(PLANS.PLUS.alturaMax).toBe(1080);
    expect(PLANS.PLUS.quadrosMax).toBe(60);
    expect(PLANS.PRO.alturaMax).toBe(1440);
  });

  it("os limites de envio sao 25 MB, 250 MB e 1 GB", () => {
    const MB = 1024 * 1024;
    expect(PLANS.FREE.uploadMaxBytes).toBe(25 * MB);
    expect(PLANS.PLUS.uploadMaxBytes).toBe(250 * MB);
    expect(PLANS.PRO.uploadMaxBytes).toBe(1024 * MB);
  });
});

/**
 * Teto de altura da tela — a regra que o gateway usa para silenciar quem
 * excede, e que a interface usa para trancar o perfil.
 *
 * Vale teste porque os dois erros possiveis sao caros e opostos: barrar quem
 * esta dentro do plano (a pessoa paga e a tela dela apaga) ou deixar passar
 * quem esta fora (o plano vira decoracao).
 */
describe("altura da tela contra o teto do plano", () => {
  it("dentro do teto passa", () => {
    expect(alturaExcedeOPlano(720, 720)).toBe(false);
    expect(alturaExcedeOPlano(1080, 1080)).toBe(false);
    expect(alturaExcedeOPlano(480, 720)).toBe(false);
  });

  it("bem acima do teto e barrado", () => {
    // o caso que motiva tudo: 1440p com plano de 720
    expect(alturaExcedeOPlano(1440, 720)).toBe(true);
    expect(alturaExcedeOPlano(1080, 720)).toBe(true);
    expect(alturaExcedeOPlano(1440, 1080)).toBe(true);
  });

  /**
   * O codificador nem sempre entrega o pedido exato: 1080p pode sair 1082
   * conforme o recorte da janela. Barrar por dois pixels puniria quem esta
   * dentro do plano.
   */
  it("tolera a folga do codificador", () => {
    expect(alturaExcedeOPlano(1082, 1080)).toBe(false);
    expect(alturaExcedeOPlano(792, 720)).toBe(false);
  });

  it("nao tolera muito alem da folga", () => {
    expect(alturaExcedeOPlano(1200, 1080)).toBe(true);
  });

  /**
   * A FRONTEIRA EXATA, fixada de proposito.
   *
   * 1080 x 1,1 da 1188. Sem este caso, trocar `>` por `>=` na regra nao
   * quebraria teste nenhum — o limite ficaria livre para escorregar um pixel a
   * cada refatoracao, e ninguem notaria ate alguem reclamar. Verificado: com a
   * mutacao, estes dois falham.
   */
  it("o limite exato da tolerancia ainda passa", () => {
    expect(alturaExcedeOPlano(1188, 1080)).toBe(false);
    expect(alturaExcedeOPlano(792, 720)).toBe(false); // 720 x 1,1
  });

  it("um pixel alem do limite ja e barrado", () => {
    expect(alturaExcedeOPlano(1189, 1080)).toBe(true);
    expect(alturaExcedeOPlano(793, 720)).toBe(true);
  });

  /**
   * Altura zero e o SFU ainda nao sabendo as dimensoes, e nao uma tela de zero
   * pixels. Tratar como excesso silenciaria toda transmissao no instante em
   * que ela comeca.
   */
  it("altura desconhecida NAO e violacao", () => {
    expect(alturaExcedeOPlano(0, 720)).toBe(false);
    expect(alturaExcedeOPlano(Number.NaN, 720)).toBe(false);
    expect(alturaExcedeOPlano(-1, 720)).toBe(false);
  });
});
