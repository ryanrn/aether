import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "../../apps/realtime/src/rate-limit";

/**
 * Token bucket do gateway (chat e sinal de "esta falando").
 *
 * Relogio falso de proposito: o comportamento em teste e recarga ao longo do
 * tempo, e uma suite que espera 4 segundos de verdade para provar 4 segundos
 * de recarga vira a suite que ninguem roda.
 */

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-21T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createRateLimiter", () => {
  it("permite a rajada ate a capacidade e recusa a proxima", () => {
    /** Digitar rapido e legitimo; fluxo continuo nao e. */
    const limiter = createRateLimiter({ capacity: 3, refillPerSecond: 1 });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
  });

  it("recarrega com o tempo", () => {
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 1 });
    limiter.take("a");
    limiter.take("a");
    expect(limiter.take("a")).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
  });

  it("nao acumula alem da capacidade por ficar ocioso", () => {
    /**
     * Sem o teto, quem ficasse uma hora calado poderia despejar milhares de
     * mensagens de uma vez — que e exatamente o que o limite existe para
     * impedir.
     */
    const limiter = createRateLimiter({ capacity: 3, refillPerSecond: 2 });
    limiter.take("a");
    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
  });

  it("conta cada chave separadamente", () => {
    /** A chave e o id do socket: um usuario barrado nao pode calar outro. */
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 0 });
    expect(limiter.take("socket-1")).toBe(true);
    expect(limiter.take("socket-1")).toBe(false);
    expect(limiter.take("socket-2")).toBe(true);
  });

  it("forget devolve a capacidade cheia a chave", () => {
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 0 });
    limiter.take("a");
    limiter.take("a");
    expect(limiter.take("a")).toBe(false);

    limiter.forget("a");
    expect(limiter.take("a")).toBe(true);
  });

  it("forget de chave inexistente nao quebra", () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1 });
    expect(() => limiter.forget("nunca-vista")).not.toThrow();
  });

  it("recarga fracionada nao libera antes da hora", () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 0.5 });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(limiter.take("a")).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(limiter.take("a")).toBe(true);
  });
});
