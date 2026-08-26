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

/**
 * REGRESSAO DE SEGURANCA — a chave do balde e a identidade, nao a conexao.
 *
 * O bug que estes testes travam: `messages.ts` chamava `limiter.take(socket.id)`
 * e `limiter.forget(socket.id)` no disconnect. Nada impede a mesma pessoa de
 * abrir varios sockets com o mesmo cookie, e cada socket novo estreava com um
 * balde cheio — o limite de 8 mensagens virava 8 vezes o numero de abas, e
 * reconectar zerava o balde de graca.
 *
 * Os testes aqui nao conseguem abrir socket. O que eles travam e a PROPRIEDADE
 * de que o limitador depende: chaves distintas nao compartilham balde. Enquanto
 * isso for verdade — e tem de ser, senao o limitador nao serve para nada — usar
 * o id do socket como chave e um bypass. Por isso o teste de integracao logo
 * abaixo confere a chamada real.
 */
describe("chave do balde", () => {
  it("chaves diferentes nao dividem o mesmo balde", () => {
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 1 });

    expect(limiter.take("socket-1")).toBe(true);
    expect(limiter.take("socket-1")).toBe(true);
    expect(limiter.take("socket-1")).toBe(false);

    /**
     * ESTA e a linha que explica o bug: uma chave nova comeca cheia. Quando a
     * chave era o id do socket, "chave nova" era so abrir outra conexao.
     */
    expect(limiter.take("socket-2")).toBe(true);
    expect(limiter.take("socket-2")).toBe(true);
  });

  it("esquecer a chave devolve a rajada inteira", () => {
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 1 });

    expect(limiter.take("ryan")).toBe(true);
    expect(limiter.take("ryan")).toBe(true);
    expect(limiter.take("ryan")).toBe(false);

    /**
     * Por que `forget` no disconnect era o segundo bypass, e nao so o
     * primeiro: mesmo com UM socket por vez, desconectar e reconectar apagava
     * o balde. O handler nao chama mais isto — o metodo continua para teste e
     * limpeza deliberada.
     */
    limiter.forget("ryan");
    expect(limiter.take("ryan")).toBe(true);
  });
});

describe("despejo de chaves ociosas", () => {
  it("descarta balde cheio e parado, e mantem quem ainda deve tokens", () => {
    const limiter = createRateLimiter({ capacity: 4, refillPerSecond: 1 });

    limiter.take("quieto");
    limiter.take("ocupado");
    limiter.take("ocupado");
    limiter.take("ocupado");
    limiter.take("ocupado"); // esvaziou: 4 de 4
    expect(limiter.size()).toBe(2);

    /**
     * Sem `forget` no disconnect, o mapa so encolhe se ele mesmo limpar. Um
     * balde CHEIO nao carrega informacao: e indistinguivel de uma chave que
     * nunca existiu, entao pode sumir sem mudar decisao nenhuma.
     *
     * 61s passa do intervalo de varredura (60s) e tambem da recarga completa
     * dos dois (capacidade 4 a 1/s = 4s para encher do zero). Os dois estao
     * cheios e parados, entao os dois saem. Quem NAO pode sair e quem ainda
     * deve tokens — e disso trata o teste seguinte.
     */
    vi.advanceTimersByTime(61_000);
    limiter.take("gatilho"); // a varredura acontece dentro do take

    // Os dois estavam cheios ha mais de um ciclo: os dois saem.
    expect(limiter.size()).toBe(1);
    expect(limiter.take("gatilho")).toBe(true);
  });

  it("nao descarta quem ainda deve tokens", () => {
    /**
     * Recarga PROPOSITALMENTE lenta (0,01/s = 200s para encher do zero).
     *
     * Sem isso o teste nao consegue falhar, e a primeira versao dele nao
     * conseguia: a varredura so roda a cada 60s, e com recarga de 1/s qualquer
     * balde ja voltou a ficar cheio quando ela chega. Nunca existia o estado
     * que importa — vazio E vivo durante uma varredura — entao despejar tudo
     * passava no teste igual.
     */
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 0.01 });

    limiter.take("gatilho"); // marca o inicio da contagem da varredura
    vi.advanceTimersByTime(61_000);

    limiter.take("no-limite");
    limiter.take("no-limite");
    expect(limiter.take("no-limite")).toBe(false);

    /**
     * Passa outra varredura com "no-limite" ainda devendo token. Se ela o
     * levasse junto, o proximo `take` criaria balde novo e devolveria `true` —
     * e ai o despejo teria virado o bypass que ele deveria evitar.
     */
    vi.advanceTimersByTime(61_000);
    limiter.take("gatilho");

    expect(limiter.take("no-limite")).toBe(false);
  });
});
