import { describe, expect, it, vi } from "vitest";
import { HUB_IDADE_MINIMA_HORAS } from "@aether/shared";
import type { ContaParaOHub } from "../../packages/access/src/hub";

vi.mock("@aether/db", () => ({ prisma: {} }));

const { motivoParaNaoEntrarNoHub, podeRemoverDaSalaDoHub } = await import(
  "../../packages/access/src/hub"
);

/**
 * A porta do hub global (fase 2, estagio 4b-1). Cada requisito recusa SOZINHO —
 * se dois se cobrissem, um deles poderia estar quebrado sem nenhum teste notar.
 */

// Horario REAL: `estaSilenciado` (reaproveitado da moderacao global) compara
// com o relogio, entao a referencia do teste tem de ser a mesma.
const AGORA = new Date();
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3_600_000);

const contaBoa: ContaParaOHub = {
  createdAt: horasAtras(HUB_IDADE_MINIMA_HORAS + 1),
  emailVerificadoEm: horasAtras(1),
  silenciadoEm: null,
  silenciadoAte: null,
  equipe: false,
};

const motivo = (conta: Partial<ContaParaOHub>, banido = false) =>
  motivoParaNaoEntrarNoHub({ ...contaBoa, ...conta }, { banido, agora: AGORA });

describe("motivoParaNaoEntrarNoHub", () => {
  it("conta verificada, com mais de 24 h, sem ban nem silenciamento: entra", () => {
    expect(motivo({})).toBeNull();
  });

  it("conta nova recusa — e o corte e exatamente a idade minima", () => {
    expect(motivo({ createdAt: horasAtras(HUB_IDADE_MINIMA_HORAS - 0.01) })).toBe("conta_nova");
    expect(motivo({ createdAt: horasAtras(HUB_IDADE_MINIMA_HORAS) })).toBeNull();
  });

  it("e-mail nao confirmado recusa", () => {
    expect(motivo({ emailVerificadoEm: null })).toBe("email_nao_verificado");
  });

  it("silenciado recusa; silenciamento vencido nao conta", () => {
    expect(motivo({ silenciadoEm: horasAtras(2), silenciadoAte: null })).toBe("silenciado");
    expect(motivo({ silenciadoEm: horasAtras(5), silenciadoAte: horasAtras(1) })).toBeNull();
  });

  it("banido do hub recusa, mesmo sendo da equipe", () => {
    expect(motivo({}, true)).toBe("banido");
    expect(motivo({ equipe: true }, true)).toBe("banido");
  });

  it("equipe passa pela idade e pelo e-mail (precisa entrar para moderar)", () => {
    expect(
      motivo({ equipe: true, createdAt: horasAtras(1), emailVerificadoEm: null }),
    ).toBeNull();
  });

  it("equipe silenciada continua recusada", () => {
    expect(motivo({ equipe: true, silenciadoEm: horasAtras(1) })).toBe("silenciado");
  });
});

describe("podeRemoverDaSalaDoHub (estagio 4b-2)", () => {
  const sala = { hub: true, criadaPor: "criador" };

  it("quem criou a sala do hub remove outra pessoa", () => {
    expect(
      podeRemoverDaSalaDoHub({ solicitanteId: "criador", alvoId: "x", sala }),
    ).toBe(true);
  });

  it("quem NAO criou nao remove ninguem", () => {
    expect(
      podeRemoverDaSalaDoHub({ solicitanteId: "outro", alvoId: "x", sala }),
    ).toBe(false);
  });

  it("ninguem remove a si mesmo", () => {
    expect(
      podeRemoverDaSalaDoHub({ solicitanteId: "criador", alvoId: "criador", sala }),
    ).toBe(false);
  });

  it("fora do hub, criar a sala nao da poder nenhum (servidor comum tem moderacao)", () => {
    expect(
      podeRemoverDaSalaDoHub({
        solicitanteId: "criador",
        alvoId: "x",
        sala: { hub: false, criadaPor: "criador" },
      }),
    ).toBe(false);
  });

  it("sala sem criador registrado: ninguem remove", () => {
    expect(
      podeRemoverDaSalaDoHub({
        solicitanteId: "criador",
        alvoId: "x",
        sala: { hub: true, criadaPor: null },
      }),
    ).toBe(false);
  });
});
