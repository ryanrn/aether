import { describe, expect, it, vi } from "vitest";

// O modulo cria a instancia padrao no import; sem REDIS_URL ela e de memoria.
vi.mock("../../apps/realtime/src/redis-client", () => ({ redisClients: null }));

const { criarRemocoes } = await import("../../apps/realtime/src/voz/remocoes-do-hub");

/**
 * O prazo de quem foi removido de uma sala do hub (estagio 4b-2), na versao
 * em memoria (a do Redis e o mesmo contrato, com `PX`/`PTTL`). O que trava:
 * o prazo vale so para AQUELA sala e AQUELA pessoa, e acaba sozinho.
 */
describe("remocoes do hub (memoria)", () => {
  it("registra e conta o prazo; depois do prazo, pode entrar", async () => {
    let t = 1_000_000;
    const r = criarRemocoes(null, 60_000, () => t);

    expect(await r.esperaRestante("sala", "u")).toBe(0);
    await r.registrar("sala", "u");
    expect(await r.esperaRestante("sala", "u")).toBe(60_000);

    t += 59_000;
    expect(await r.esperaRestante("sala", "u")).toBe(1_000);
    t += 1_000;
    expect(await r.esperaRestante("sala", "u")).toBe(0);
  });

  it("vale so para aquela sala e aquela pessoa", async () => {
    const r = criarRemocoes(null, 60_000, () => 0);
    await r.registrar("sala", "u");
    expect(await r.esperaRestante("outra-sala", "u")).toBe(0);
    expect(await r.esperaRestante("sala", "outra-pessoa")).toBe(0);
  });

  it("remover de novo renova o prazo", async () => {
    let t = 0;
    const r = criarRemocoes(null, 60_000, () => t);
    await r.registrar("sala", "u");
    t = 50_000;
    await r.registrar("sala", "u");
    expect(await r.esperaRestante("sala", "u")).toBe(60_000);
  });
});
