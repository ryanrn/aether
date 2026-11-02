import { describe, expect, it } from "vitest";
import {
  colecaoMetaSchema,
  colecaoNoAr,
  exigeResgate,
  itemNoAr,
  podeEquiparItem,
  rotuloDoPrazo,
} from "@aether/shared";

/** A regra do periodo das colecoes da loja (Estagio 3b). Funcoes puras. */

const AGORA = new Date("2026-11-03T12:00:00Z");
const ANTES = new Date("2026-11-01T00:00:00Z");
const DEPOIS = new Date("2026-11-10T00:00:00Z");

describe("colecaoNoAr", () => {
  it("ativa e sem limites: no ar", () => {
    expect(colecaoNoAr({ ativa: true, inicioEm: null, fimEm: null }, AGORA)).toBe(true);
  });
  it("desativada: fora, mesmo dentro do periodo", () => {
    expect(colecaoNoAr({ ativa: false, inicioEm: ANTES, fimEm: DEPOIS }, AGORA)).toBe(false);
  });
  it("antes do inicio e depois do fim: fora", () => {
    expect(colecaoNoAr({ ativa: true, inicioEm: DEPOIS, fimEm: null }, AGORA)).toBe(false);
    expect(colecaoNoAr({ ativa: true, inicioEm: null, fimEm: ANTES }, AGORA)).toBe(false);
  });
  it("o fim e exclusivo; o inicio, inclusivo", () => {
    expect(colecaoNoAr({ ativa: true, inicioEm: null, fimEm: AGORA }, AGORA)).toBe(false);
    expect(colecaoNoAr({ ativa: true, inicioEm: AGORA, fimEm: null }, AGORA)).toBe(true);
  });
  it("item sem colecao: sempre no ar", () => {
    expect(itemNoAr(null, AGORA)).toBe(true);
    expect(itemNoAr(undefined, AGORA)).toBe(true);
  });
});

describe("exigeResgate", () => {
  const COM_PRAZO = { ativa: true, inicioEm: null, fimEm: DEPOIS };
  it("so gratis numa colecao com fim", () => {
    expect(exigeResgate(null, COM_PRAZO)).toBe(true);
    expect(exigeResgate(300, COM_PRAZO)).toBe(false);
    expect(exigeResgate(null, { ...COM_PRAZO, fimEm: null })).toBe(false);
    expect(exigeResgate(null, null)).toBe(false);
  });
});

describe("podeEquiparItem", () => {
  const ENCERRADA = { ativa: true, inicioEm: null, fimEm: ANTES };
  const NO_AR_COM_PRAZO = { ativa: true, inicioEm: null, fimEm: DEPOIS };
  const AGENDADA = { ativa: true, inicioEm: DEPOIS, fimEm: null };

  it("quem possui equipa sempre, mesmo com a colecao encerrada", () => {
    expect(podeEquiparItem({ precoMoedas: 300, colecao: ENCERRADA, temPosse: true, agora: AGORA })).toBe(true);
    expect(podeEquiparItem({ precoMoedas: null, colecao: ENCERRADA, temPosse: true, agora: AGORA })).toBe(true);
  });
  it("pago sem posse: nunca", () => {
    expect(podeEquiparItem({ precoMoedas: 300, colecao: null, temPosse: false, agora: AGORA })).toBe(false);
  });
  it("gratis de colecao com prazo sem resgate: nao (precisa resgatar)", () => {
    expect(podeEquiparItem({ precoMoedas: null, colecao: NO_AR_COM_PRAZO, temPosse: false, agora: AGORA })).toBe(false);
  });
  it("gratis sem prazo: so com a colecao no ar", () => {
    expect(podeEquiparItem({ precoMoedas: null, colecao: null, temPosse: false, agora: AGORA })).toBe(true);
    expect(podeEquiparItem({ precoMoedas: null, colecao: AGENDADA, temPosse: false, agora: AGORA })).toBe(false);
  });
});

describe("rotuloDoPrazo", () => {
  it("sem prazo ou ja passado: nada", () => {
    expect(rotuloDoPrazo(null, AGORA)).toBeNull();
    expect(rotuloDoPrazo(ANTES.toISOString(), AGORA)).toBeNull();
  });
  it("horas abaixo de um dia; dias arredondados para cima", () => {
    expect(rotuloDoPrazo("2026-11-03T12:20:00Z", AGORA)).toBe("Sai em 1h");
    expect(rotuloDoPrazo("2026-11-04T06:00:00Z", AGORA)).toBe("Sai em 18h");
    expect(rotuloDoPrazo("2026-11-04T13:00:00Z", AGORA)).toBe("Sai em 2 dias");
    expect(rotuloDoPrazo(DEPOIS.toISOString(), AGORA)).toBe("Sai em 7 dias");
  });
});

describe("colecaoMetaSchema", () => {
  const BASE = { nome: "Neon", slug: "neon", destaque: true, ativa: true, ordem: "2" };
  it("datas vazias viram null; ISO vira Date", () => {
    const r = colecaoMetaSchema.parse({ ...BASE, inicioEm: "", fimEm: DEPOIS.toISOString() });
    expect(r.inicioEm).toBeNull();
    expect(r.fimEm).toEqual(DEPOIS);
    expect(r.ordem).toBe(2);
    expect(r.descricao).toBeNull();
  });
  it("fim antes do inicio: recusa no campo fimEm", () => {
    const r = colecaoMetaSchema.safeParse({ ...BASE, inicioEm: DEPOIS.toISOString(), fimEm: ANTES.toISOString() });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path[0]).toBe("fimEm");
  });
  it("data invalida: recusa", () => {
    expect(colecaoMetaSchema.safeParse({ ...BASE, fimEm: "nao-e-data" }).success).toBe(false);
  });
});
