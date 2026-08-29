import { describe, expect, it } from "vitest";
import {
  MOLDURAS,
  molduraEfetiva,
  molduraPorId,
  moldurasDoPlano,
  podeAvatarAnimado,
  type PlanTier,
} from "@aether/shared";

/**
 * Cosmeticos de perfil — quem pode usar o que, e o que aparece quando o plano
 * cai.
 *
 * Vale teste porque os dois erros possiveis sao opostos e ambos caros: barrar
 * quem paga (a pessoa comprou e a moldura nao aparece) ou exibir para quem
 * deixou de pagar (o cosmetico de assinatura vira compra unica, e ninguem
 * reclama porque favorece quem tem).
 */

const TIERS: PlanTier[] = ["FREE", "PLUS", "PRO"];

describe("o catalogo", () => {
  it("tem ids unicos", () => {
    const ids = MOLDURAS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * Ao menos uma gratuita. Catalogo inteiro trancado nao convida a assinar:
   * so avisa que voce nao pertence, e quem nao paga nunca chega a mexer no
   * recurso para querer o resto.
   */
  it("todo plano tem PELO MENOS uma moldura", () => {
    for (const tier of TIERS) {
      expect(moldurasDoPlano(tier).length).toBeGreaterThan(0);
    }
  });

  it("quem paga mais nunca ve menos opcoes", () => {
    expect(moldurasDoPlano("PRO").length).toBeGreaterThanOrEqual(
      moldurasDoPlano("PLUS").length,
    );
    expect(moldurasDoPlano("PLUS").length).toBeGreaterThanOrEqual(
      moldurasDoPlano("FREE").length,
    );
  });

  it("id desconhecido nao existe no catalogo", () => {
    expect(molduraPorId("nao-existe")).toBeNull();
    expect(molduraPorId(null)).toBeNull();
    expect(molduraPorId("")).toBeNull();
  });
});

describe("a moldura que vale agora", () => {
  it("sem escolha, nao ha moldura", () => {
    expect(molduraEfetiva(null, "PRO")).toBeNull();
  });

  it("o plano que cobre desenha", () => {
    expect(molduraEfetiva("bronze", "FREE")?.id).toBe("bronze");
    expect(molduraEfetiva("eter", "PLUS")?.id).toBe("eter");
    expect(molduraEfetiva("olimpo", "PRO")?.id).toBe("olimpo");
  });

  it("quem paga MAIS tambem usa a moldura de baixo", () => {
    expect(molduraEfetiva("bronze", "PRO")?.id).toBe("bronze");
    expect(molduraEfetiva("eter", "PRO")?.id).toBe("eter");
  });

  /**
   * O CASO QUE PROTEGE A ASSINATURA: escolheu no Olimpo Pro, deixou de pagar,
   * a moldura para de aparecer. A ESCOLHA continua guardada no banco — quem
   * some e o desenho, nao o dado —, entao reativar devolve sem a pessoa
   * precisar lembrar qual era.
   */
  it("plano que NAO cobre deixa de desenhar", () => {
    expect(molduraEfetiva("olimpo", "PLUS")).toBeNull();
    expect(molduraEfetiva("olimpo", "FREE")).toBeNull();
    expect(molduraEfetiva("eter", "FREE")).toBeNull();
  });

  /**
   * Moldura retirada do catalogo nao pode quebrar a tela de quem a tinha: o
   * banco guarda um id que o codigo talvez nao conheca mais.
   */
  it("id que sumiu do catalogo vira nenhuma, sem lancar", () => {
    expect(molduraEfetiva("moldura-de-2019", "PRO")).toBeNull();
  });
});

describe("avatar animado", () => {
  it("e exclusivo do plano de cima", () => {
    expect(podeAvatarAnimado("PRO")).toBe(true);
    expect(podeAvatarAnimado("PLUS")).toBe(false);
    expect(podeAvatarAnimado("FREE")).toBe(false);
  });
});
