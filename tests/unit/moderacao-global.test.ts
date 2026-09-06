import { afterEach, describe, expect, it, vi } from "vitest";
import { estaSilenciado } from "../../packages/access/src/moderacao-global";

/**
 * `estaSilenciado` — a regra que o gateway usa para barrar `message:send`.
 *
 * O ponto: silenciamento COM PRAZO que ja passou nao conta. Mesma logica de
 * "ban vencido nao conta" da moderacao de servidor — a linha fica como
 * historico, mas nao bloqueia mais.
 */

afterEach(() => vi.useRealTimers());

describe("estaSilenciado", () => {
  it("sem silenciadoEm: não está silenciado", () => {
    expect(estaSilenciado({ silenciadoEm: null, silenciadoAte: null })).toBe(false);
  });

  it("silenciadoEm sem prazo (indefinido): está silenciado", () => {
    expect(
      estaSilenciado({ silenciadoEm: new Date("2026-01-01"), silenciadoAte: null }),
    ).toBe(true);
  });

  it("silenciado com prazo no futuro: está silenciado", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
    expect(
      estaSilenciado({
        silenciadoEm: new Date("2026-09-06T10:00:00Z"),
        silenciadoAte: new Date("2026-09-07T10:00:00Z"),
      }),
    ).toBe(true);
  });

  it("silenciado com prazo JÁ VENCIDO: não conta mais", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
    expect(
      estaSilenciado({
        silenciadoEm: new Date("2026-09-01T10:00:00Z"),
        silenciadoAte: new Date("2026-09-05T10:00:00Z"), // ontem
      }),
    ).toBe(false);
  });
});
