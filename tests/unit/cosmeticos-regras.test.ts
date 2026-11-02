import { describe, expect, it } from "vitest";
import { COSMETIC_REGRAS, type CosmeticType } from "@aether/shared";

/**
 * O tamanho que o painel ANUNCIA como alvo de cada tipo tem de passar na
 * regra que o servidor aplica. Ja aconteceu de o banner pedir "~1500x500" e
 * recusar 1500x500 (lado minimo 600 valia tambem para a altura).
 */

const ALVO: Record<CosmeticType, [number, number]> = {
  DECORATION: [512, 512],
  BANNER: [1500, 500],
  NAMEPLATE: [720, 120],
  PROFILE_EFFECT: [600, 800],
};

function passa(tipo: CosmeticType, largura: number, altura: number): boolean {
  const r = COSMETIC_REGRAS[tipo];
  const ratio = largura / altura;
  return (
    Math.min(largura, altura) >= r.ladoMin &&
    Math.max(largura, altura) <= r.ladoMax &&
    ratio >= r.ratioMin &&
    ratio <= r.ratioMax
  );
}

describe("COSMETIC_REGRAS", () => {
  for (const [tipo, [w, h]] of Object.entries(ALVO) as [CosmeticType, [number, number]][]) {
    it(`${tipo}: o alvo ${w}x${h} passa e aparece no texto do alvo`, () => {
      expect(passa(tipo, w, h)).toBe(true);
      expect(COSMETIC_REGRAS[tipo].alvo).toContain(`${w}x${h}`);
    });
  }

  it("BANNER: aceita 1200x400, recusa 900x300", () => {
    expect(passa("BANNER", 1200, 400)).toBe(true);
    expect(passa("BANNER", 900, 300)).toBe(false);
  });
});
