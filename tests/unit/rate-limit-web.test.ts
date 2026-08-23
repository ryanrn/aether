import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimitInMemory } from "../../apps/web/src/server/auth/rate-limit";

/**
 * Janela deslizante do app web — o que segura forca bruta em /login.
 *
 * IMPORTANTE: o que se testa aqui e o ALGORITMO da janela deslizante, contra a
 * implementacao EM MEMORIA (`rateLimitInMemory`) — a que roda em
 * desenvolvimento e a que sobra quando nao ha Redis configurado.
 *
 * Em producao, na Vercel, cada instancia serverless teria o proprio contador;
 * por isso a fase 7c pos o mesmo algoritmo num script Lua no Redis. O contrato
 * com o Redis esta em rate-limit-redis.test.ts. As duas implementacoes
 * espelham a MESMA regra de proposito — inclusive o detalhe de que a tentativa
 * recusada nao entra no balde.
 *
 * Cada teste usa uma chave propria: o mapa de buckets e modulo, compartilhado
 * pelo arquivo inteiro.
 */

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-21T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const WINDOW = 5 * 60_000;

describe("rateLimit", () => {
  it("permite ate o limite e recusa o excedente", () => {
    for (let i = 0; i < 10; i += 1) {
      expect(rateLimitInMemory("login:permite", 10, WINDOW).ok).toBe(true);
    }
    expect(rateLimitInMemory("login:permite", 10, WINDOW).ok).toBe(false);
  });

  it("informa quanto falta para liberar", () => {
    for (let i = 0; i < 3; i += 1) rateLimitInMemory("login:retry", 3, WINDOW);

    const blocked = rateLimitInMemory("login:retry", 3, WINDOW);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.retryAfter).toBeLessThanOrEqual(WINDOW / 1000);
  });

  it("libera quando a janela passa", () => {
    for (let i = 0; i < 3; i += 1) rateLimitInMemory("login:janela", 3, WINDOW);
    expect(rateLimitInMemory("login:janela", 3, WINDOW).ok).toBe(false);

    vi.advanceTimersByTime(WINDOW + 1000);
    expect(rateLimitInMemory("login:janela", 3, WINDOW).ok).toBe(true);
  });

  it("desliza: a janela conta as ultimas N tentativas, nao blocos fixos", () => {
    /**
     * Duas tentativas agora e uma daqui a pouco. Quando as duas primeiras
     * vencem, sobra espaco — sem que o contador tenha zerado de uma vez.
     */
    rateLimitInMemory("login:desliza", 3, WINDOW);
    rateLimitInMemory("login:desliza", 3, WINDOW);
    vi.advanceTimersByTime(WINDOW / 2);
    rateLimitInMemory("login:desliza", 3, WINDOW);
    expect(rateLimitInMemory("login:desliza", 3, WINDOW).ok).toBe(false);

    // passa a metade que faltava: as duas primeiras saem da janela
    vi.advanceTimersByTime(WINDOW / 2 + 1000);
    expect(rateLimitInMemory("login:desliza", 3, WINDOW).ok).toBe(true);
  });

  it("tentativa recusada nao estende a punicao", () => {
    /**
     * Se a tentativa bloqueada entrasse no bucket, insistir empurraria a
     * liberacao para sempre adiante — quem errou a senha ficaria trancado
     * enquanto continuasse tentando, mesmo depois da janela.
     */
    for (let i = 0; i < 2; i += 1) rateLimitInMemory("login:sem-castigo", 2, WINDOW);

    for (let i = 0; i < 20; i += 1) {
      vi.advanceTimersByTime(1000);
      expect(rateLimitInMemory("login:sem-castigo", 2, WINDOW).ok).toBe(false);
    }

    // a janela conta a partir da PRIMEIRA tentativa, nao da ultima recusa
    vi.advanceTimersByTime(WINDOW - 20_000 + 1000);
    expect(rateLimitInMemory("login:sem-castigo", 2, WINDOW).ok).toBe(true);
  });

  it("conta cada chave separadamente", () => {
    /** IP barrado nao pode barrar o resto da internet. */
    expect(rateLimitInMemory("login:ip-a", 1, WINDOW).ok).toBe(true);
    expect(rateLimitInMemory("login:ip-a", 1, WINDOW).ok).toBe(false);
    expect(rateLimitInMemory("login:ip-b", 1, WINDOW).ok).toBe(true);
  });

  it("limite zero recusa tudo", () => {
    expect(rateLimitInMemory("login:zero", 0, WINDOW).ok).toBe(false);
  });
});
