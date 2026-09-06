import { describe, expect, it } from "vitest";
import { precisaAceitarTermos, VERSAO_DOS_TERMOS } from "@aether/shared";

/**
 * `precisaAceitarTermos` — o guard do modal em `/app`.
 *
 * O ponto: nunca aceitou OU aceitou uma versao antiga => precisa de novo.
 * Guardar a versao (e nao so um booleano) e o que permite pedir re-aceite
 * quando os termos mudam de verdade.
 */

describe("precisaAceitarTermos", () => {
  it("nunca aceitou -> precisa", () => {
    expect(
      precisaAceitarTermos({ aceitouTermosEm: null, termosVersao: null }),
    ).toBe(true);
  });

  it("aceitou a versao atual -> não precisa", () => {
    expect(
      precisaAceitarTermos({
        aceitouTermosEm: new Date(),
        termosVersao: VERSAO_DOS_TERMOS,
      }),
    ).toBe(false);
  });

  it("aceitou uma versao antiga -> precisa de novo", () => {
    expect(
      precisaAceitarTermos({
        aceitouTermosEm: new Date("2025-01-01"),
        termosVersao: "2025-01-01",
      }),
    ).toBe(true);
  });

  it("tem data mas versao nula (dado inconsistente) -> precisa", () => {
    expect(
      precisaAceitarTermos({ aceitouTermosEm: new Date(), termosVersao: null }),
    ).toBe(true);
  });
});
