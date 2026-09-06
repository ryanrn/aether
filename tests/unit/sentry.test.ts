import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarSinkSentry, parseDsn } from "../../packages/shared/src/sentry";
import type { RegistroDeLog } from "../../packages/shared/src/log";

/**
 * Sink do Sentry por fetch cru.
 *
 * O que os testes travam: (1) o envelope tem o formato que a API de ingestao
 * aceita — tres linhas NDJSON, header de auth certo; (2) so `error`/`warn`
 * sobem; (3) a dedupe impede um laco de estourar a cota; (4) nada aqui lanca.
 */

function registro(over: Partial<RegistroDeLog> = {}): RegistroDeLog {
  return {
    ts: "2026-09-05T12:00:00.000Z",
    nivel: "error",
    evento: "teste.falhou",
    msg: "algo quebrou",
    ...over,
  };
}

describe("parseDsn", () => {
  it("DSN moderno (sem secret)", () => {
    const p = parseDsn("https://abc123@o1.ingest.sentry.io/456");
    expect(p).toEqual({
      host: "o1.ingest.sentry.io",
      projeto: "456",
      chave: "abc123",
      urlEnvelope: "https://o1.ingest.sentry.io/api/456/envelope/",
    });
  });

  it("DSN com prefixo de caminho", () => {
    const p = parseDsn("https://k@sentry.example.com/base/path/789");
    expect(p?.urlEnvelope).toBe(
      "https://sentry.example.com/base/path/api/789/envelope/",
    );
  });

  it("sem chave -> null", () => {
    expect(parseDsn("https://o1.ingest.sentry.io/456")).toBeNull();
  });

  it("lixo -> null, sem lancar", () => {
    expect(parseDsn("nao e url")).toBeNull();
    expect(parseDsn("")).toBeNull();
  });
});

describe("criarSinkSentry", () => {
  const DSN = "https://pubkey@o1.ingest.sentry.io/42";
  let enviado: { url: string; corpo: string; headers: Record<string, string> }[];
  const enviar = (url: string, corpo: string, headers: Record<string, string>) => {
    enviado.push({ url, corpo, headers });
  };

  beforeEach(() => {
    enviado = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("devolve null sem DSN", () => {
    expect(criarSinkSentry({ enviar })).toBeNull();
  });

  it("devolve null com DSN malformado", () => {
    expect(criarSinkSentry({ dsn: "xxx", enviar })).toBeNull();
  });

  it("nao manda info nem debug", () => {
    const sink = criarSinkSentry({ dsn: DSN, enviar })!;
    sink(registro({ nivel: "info" }));
    sink(registro({ nivel: "debug" }));
    expect(enviado).toHaveLength(0);
  });

  it("manda error e warn", () => {
    const sink = criarSinkSentry({ dsn: DSN, enviar })!;
    sink(registro({ nivel: "error", evento: "a" }));
    sink(registro({ nivel: "warn", evento: "b" }));
    expect(enviado).toHaveLength(2);
  });

  it("o envelope tem 3 linhas NDJSON e o endpoint certo", () => {
    const sink = criarSinkSentry({ dsn: DSN, servico: "gateway", enviar })!;
    sink(registro());

    const { url, corpo, headers } = enviado[0]!;
    expect(url).toBe("https://o1.ingest.sentry.io/api/42/envelope/");
    expect(headers["content-type"]).toBe("application/x-sentry-envelope");
    expect(headers["x-sentry-auth"]).toContain("sentry_key=pubkey");

    const linhas = corpo.split("\n");
    expect(linhas).toHaveLength(3);
    const cabecalho = JSON.parse(linhas[0]!);
    const itemHeader = JSON.parse(linhas[1]!);
    const evento = JSON.parse(linhas[2]!);
    expect(cabecalho.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(itemHeader).toEqual({ type: "event" });
    expect(evento.level).toBe("error");
    expect(evento.logger).toBe("teste.falhou");
    expect(evento.server_name).toBe("gateway");
    expect(evento.tags.evento).toBe("teste.falhou");
  });

  it("campos de contexto do registro viram tags (escalares) e extra (resto)", () => {
    const sink = criarSinkSentry({ dsn: DSN, enviar })!;
    sink(
      registro({
        userId: "u1",
        socketId: "s1",
        detalhe: { a: 1 },
      } as RegistroDeLog),
    );
    const evento = JSON.parse(enviado[0]!.corpo.split("\n")[2]!);
    expect(evento.tags.userId).toBe("u1");
    expect(evento.tags.socketId).toBe("s1");
    expect(evento.extra.detalhe).toEqual({ a: 1 });
  });

  it("com erro: monta exception.values e parseia o stack em frames", () => {
    const sink = criarSinkSentry({ dsn: DSN, enviar })!;
    const stack = [
      "Error: falha X",
      "    at fazAlgo (/app/src/svc.ts:10:5)",
      "    at /app/node_modules/lib/index.js:99:1",
    ].join("\n");
    sink(registro({ err: { nome: "Error", mensagem: "falha X", stack } }));

    const evento = JSON.parse(enviado[0]!.corpo.split("\n")[2]!);
    const val = evento.exception.values[0];
    expect(val.type).toBe("Error");
    expect(val.value).toBe("falha X");
    // ordem invertida: o frame de origem (svc.ts) fica por ultimo
    const frames = val.stacktrace.frames;
    expect(frames[frames.length - 1]).toMatchObject({
      function: "fazAlgo",
      filename: "/app/src/svc.ts",
      lineno: 10,
      in_app: true,
    });
    expect(frames[0]).toMatchObject({
      filename: "/app/node_modules/lib/index.js",
      in_app: false,
    });
  });

  it("dedupe: o mesmo evento+msg em 10s vai uma vez, depois disso de novo", () => {
    const sink = criarSinkSentry({ dsn: DSN, enviar })!;
    sink(registro());
    sink(registro());
    sink(registro());
    expect(enviado).toHaveLength(1);

    vi.advanceTimersByTime(10_001);
    sink(registro());
    expect(enviado).toHaveLength(2);
  });

  it("evento diferente nao e deduplicado junto", () => {
    const sink = criarSinkSentry({ dsn: DSN, enviar })!;
    sink(registro({ evento: "a" }));
    sink(registro({ evento: "b" }));
    expect(enviado).toHaveLength(2);
  });

  it("o enviar padrao (fetch) nao propaga erro", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("rede"))),
    );
    const sink = criarSinkSentry({ dsn: DSN })!;
    expect(() => sink(registro())).not.toThrow();
    vi.unstubAllGlobals();
  });
});
