import { describe, expect, it } from "vitest";
import { chaveDoPeriodo, formatarProgresso } from "@aether/shared";

/**
 * O periodo de uma missao: gateway (que conta) e web (que resgata) precisam
 * achar a MESMA chave, inclusive nas bordas — virada de dia em Brasilia, e
 * semanas ISO que atravessam o ano.
 */

describe("chaveDoPeriodo", () => {
  it.each([
    ["2026-11-02T12:00:00Z", "2026-11-02", "2026-W45"],
    // 23h de domingo em Brasilia ja e segunda em UTC: continua domingo.
    ["2026-11-02T02:00:00Z", "2026-11-01", "2026-W44"],
    // 00h01 de segunda em Brasilia: semana nova.
    ["2026-11-02T03:01:00Z", "2026-11-02", "2026-W45"],
    ["2026-01-01T12:00:00Z", "2026-01-01", "2026-W01"],
    // Ano de 53 semanas: o 1o de janeiro de 2027 ainda e da semana 53 de 2026.
    ["2027-01-01T12:00:00Z", "2027-01-01", "2026-W53"],
    // E o 30 de dezembro de 2024 ja e da semana 1 de 2025.
    ["2024-12-30T12:00:00Z", "2024-12-30", "2025-W01"],
    ["2021-01-03T12:00:00Z", "2021-01-03", "2020-W53"],
  ])("%s -> dia %s, semana %s", (iso, dia, semana) => {
    const t = new Date(iso);
    expect(chaveDoPeriodo("DIARIA", t)).toBe(dia);
    expect(chaveDoPeriodo("SEMANAL", t)).toBe(semana);
  });
});

describe("formatarProgresso", () => {
  it("minutos, horas e dias; nunca passa da meta", () => {
    expect(formatarProgresso("MINUTOS_EM_VOZ", 12, 30)).toBe("12 / 30 min");
    expect(formatarProgresso("MINUTOS_EM_VOZ", 90, 300)).toBe("1,5 / 5 h");
    expect(formatarProgresso("DIAS_ATIVOS", 3, 7)).toBe("3 / 7 dias");
    expect(formatarProgresso("DIAS_ATIVOS", 4, 1)).toBe("1 / 1 dia");
  });
});
