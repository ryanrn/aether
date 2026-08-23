import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "../../apps/web/src/server/auth/rate-limit";

/**
 * Rate limit distribuido (fase 7c).
 *
 * O `fetch` e dublado: o alvo aqui e o CONTRATO com o Redis — que a chamada
 * seja atomica (um EVAL, nao varios comandos), que a chave seja isolada por
 * prefixo, e sobretudo o que acontece quando o Redis falha.
 *
 * O que NAO e testado: a semantica da janela deslizante rodando de verdade no
 * Redis. Isso depende do interpretador Lua do servidor, e um duble que
 * "interpretasse" o script estaria testando o duble. A semantica em si esta
 * coberta em rate-limit-web.test.ts, contra a implementacao em memoria — e as
 * duas espelham a mesma regra de proposito.
 */

const ORIGINAL_URL = process.env.UPSTASH_REDIS_REST_URL;
const ORIGINAL_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function useRedisEnv() {
  process.env.UPSTASH_REDIS_REST_URL = "https://exemplo.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-teste";
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_URL === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = ORIGINAL_URL;
  if (ORIGINAL_TOKEN === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = ORIGINAL_TOKEN;
});

/** Duble que responde como o Upstash e registra o que recebeu. */
function stubUpstash(result: unknown) {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init.body)),
        headers: init.headers as Record<string, string>,
      });
      return new Response(JSON.stringify({ result }), { status: 200 });
    }),
  );
  return calls;
}

describe("sem Redis configurado", () => {
  it("cai para memoria em vez de falhar", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await rateLimit("fallback:memoria", 5, 60_000);

    expect(result.ok).toBe(true);
    // O ponto: sem configuracao, nao ha ida a rede nenhuma.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("meia configuracao tambem cai para memoria", async () => {
    /** URL sem token e configuracao quebrada; tratar como ausente e o seguro. */
    process.env.UPSTASH_REDIS_REST_URL = "https://exemplo.upstash.io";
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await rateLimit("fallback:meio", 5, 60_000);
    expect(result.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("com Redis configurado", () => {
  beforeEach(useRedisEnv);

  it("libera quando o script devolve 1", async () => {
    stubUpstash([1, 0]);
    const result = await rateLimit("login:1.2.3.4", 10, 300_000);
    expect(result).toEqual({ ok: true, retryAfter: 0 });
  });

  it("bloqueia e repassa o retryAfter que o script calculou", async () => {
    stubUpstash([0, 42]);
    const result = await rateLimit("login:1.2.3.4", 10, 300_000);
    expect(result).toEqual({ ok: false, retryAfter: 42 });
  });

  it("faz UMA chamada atomica de EVAL, nao uma sequencia de comandos", async () => {
    /**
     * O detalhe que importa: com comandos separados, duas tentativas
     * simultaneas leem o mesmo contador antes de qualquer uma escrever, e as
     * duas passam. Um EVAL so fecha essa corrida.
     */
    const calls = stubUpstash([1, 0]);
    await rateLimit("login:1.2.3.4", 10, 300_000);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://exemplo.upstash.io/eval");
  });

  it("autentica com o token e isola a chave por prefixo", async () => {
    const calls = stubUpstash([1, 0]);
    await rateLimit("login:1.2.3.4", 10, 300_000);

    const { headers, body } = calls[0]!;
    expect(headers.authorization).toBe("Bearer token-de-teste");

    // [script, numKeys, ...keys, ...args]
    const payload = body as unknown[];
    expect(payload[1]).toBe(1);
    expect(payload[2]).toBe("ratelimit:login:1.2.3.4");
  });

  it("passa limite e janela como argumentos, nao embutidos no script", async () => {
    /**
     * Script fixo com argumentos variaveis: o Redis reaproveita o cache do
     * script compilado, e nao ha como uma chave montar Lua diferente.
     */
    const calls = stubUpstash([1, 0]);
    await rateLimit("login:1.2.3.4", 7, 123_000);

    const payload = calls[0]!.body as unknown[];
    const args = payload.slice(3).map(String);
    expect(args).toContain("123000"); // janela
    expect(args).toContain("7"); // limite
  });

  it("normaliza a barra final da URL", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://exemplo.upstash.io/";
    const calls = stubUpstash([1, 0]);
    await rateLimit("login:1.2.3.4", 10, 300_000);
    expect(calls[0]!.url).toBe("https://exemplo.upstash.io/eval");
  });
});

describe("com Redis fora do ar", () => {
  beforeEach(useRedisEnv);

  it("LIBERA a acao quando a rede falha (fail-open)", async () => {
    /**
     * Escolha deliberada: rate limit e defesa em profundidade, nao a
     * autenticacao em si. Um Redis fora do ar nao pode derrubar o login do
     * produto inteiro — a senha continua sendo verificada normalmente logo
     * depois. Bloquear aqui transformaria uma indisponibilidade de cache em
     * indisponibilidade total.
     */
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await rateLimit("login:1.2.3.4", 10, 300_000);
    expect(result).toEqual({ ok: true, retryAfter: 0 });
  });

  it("libera tambem quando o Upstash responde erro HTTP", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await rateLimit("login:1.2.3.4", 10, 300_000);
    expect(result.ok).toBe(true);
  });

  it("libera quando o Redis devolve erro de script", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "ERR bad script" }), { status: 200 })),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await rateLimit("login:1.2.3.4", 10, 300_000);
    expect(result.ok).toBe(true);
  });

  it("registra a falha em vez de engolir em silencio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await rateLimit("login:1.2.3.4", 10, 300_000);
    expect(spy).toHaveBeenCalled();
  });
});
