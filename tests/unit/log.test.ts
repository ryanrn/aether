import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetarLogParaTeste,
  capturarFalhasDoProcesso,
  comContexto,
  configurarLog,
  contextoAtual,
  log,
  serializarErro,
  type RegistroDeLog,
} from "../../packages/shared/src/log";

/**
 * Log estruturado (@aether/shared/log).
 *
 * Os testes aqui travam DUAS propriedades das quais o resto da observabilidade
 * depende:
 *
 *  1. REDACAO. Se senha, token, e-mail ou conteudo de mensagem vazarem para uma
 *     linha de log, o log vira um segundo lugar de onde extrair segredo — e um
 *     que costuma ir para um drain de terceiro. A redacao nao pode depender de
 *     quem chama lembrar de limpar o objeto.
 *  2. LOGAR NUNCA QUEBRA O CAMINHO QUE OBSERVA. Um destino ou sink que lanca
 *     (Sentry fora do ar, JSON com BigInt) nao pode propagar para dentro do
 *     `catch` de uma server action.
 */

let capturado: RegistroDeLog[];

beforeEach(() => {
  _resetarLogParaTeste();
  capturado = [];
  configurarLog({ nivelMinimo: "debug", destino: (r) => capturado.push(r) });
});

afterEach(() => {
  _resetarLogParaTeste();
  vi.useRealTimers();
});

describe("forma do registro", () => {
  it("toda linha tem ts ISO, nivel, evento e msg", () => {
    log.info("teste.basico", "algo aconteceu");
    expect(capturado).toHaveLength(1);
    const r = capturado[0]!;
    expect(r.nivel).toBe("info");
    expect(r.evento).toBe("teste.basico");
    expect(r.msg).toBe("algo aconteceu");
    expect(() => new Date(r.ts).toISOString()).not.toThrow();
    expect(new Date(r.ts).toISOString()).toBe(r.ts);
  });

  it("os quatro niveis chamam o destino", () => {
    log.debug("e", "d");
    log.info("e", "i");
    log.warn("e", "w");
    log.error("e", "x");
    expect(capturado.map((r) => r.nivel)).toEqual(["debug", "info", "warn", "error"]);
  });
});

describe("nivel minimo", () => {
  it("descarta abaixo do minimo configurado", () => {
    configurarLog({ nivelMinimo: "warn" });
    log.debug("e", "d");
    log.info("e", "i");
    log.warn("e", "w");
    log.error("e", "x");
    expect(capturado.map((r) => r.nivel)).toEqual(["warn", "error"]);
  });
});

describe("redacao", () => {
  it("substitui o valor de chave sensivel por [redigido]", () => {
    log.info("auth.tentativa", "login", {
      email: "ryan@exemplo.com",
      senha: "hunter2",
      password: "hunter2",
      token: "eyJabc.def.ghi",
      accessToken: "aaa",
      refreshToken: "bbb",
    });
    const r = capturado[0]! as unknown as Record<string, string>;
    expect(r.email).toBe("[redigido]");
    expect(r.senha).toBe("[redigido]");
    expect(r.password).toBe("[redigido]");
    expect(r.token).toBe("[redigido]");
    expect(r.accessToken).toBe("[redigido]");
    expect(r.refreshToken).toBe("[redigido]");
  });

  it("redige em profundidade e dentro de array", () => {
    log.info("evento", "msg", {
      usuario: { nome: "Ryan", senha: "x" },
      sessoes: [{ id: "1", token: "abc" }, { id: "2", token: "def" }],
    });
    const r = capturado[0]! as unknown as {
      usuario: { nome: string; senha: string };
      sessoes: Array<{ id: string; token: string }>;
    };
    expect(r.usuario.nome).toBe("Ryan");
    expect(r.usuario.senha).toBe("[redigido]");
    expect(r.sessoes[0]!.token).toBe("[redigido]");
    expect(r.sessoes[1]!.token).toBe("[redigido]");
    expect(r.sessoes[0]!.id).toBe("1");
  });

  it("nao redige chave parecida mas inocente", () => {
    /** `emailVerified` / `tokenExpiresAt` sao metadados, nao o segredo. */
    log.info("e", "m", { emailVerified: true, tokenExpiresAt: "2026-01-01" });
    const r = capturado[0]! as unknown as Record<string, unknown>;
    expect(r.emailVerified).toBe(true);
    expect(r.tokenExpiresAt).toBe("2026-01-01");
  });

  it("corta string absurda em vez de despejar tudo", () => {
    const enorme = "x".repeat(5000);
    log.info("e", "m", { blob: enorme });
    const r = capturado[0]! as unknown as { blob: string };
    expect(r.blob.length).toBeLessThan(2100);
    expect(r.blob).toContain("(+3000)");
  });

  it("quebra ciclo em vez de estourar a pilha", () => {
    const a: Record<string, unknown> = { nome: "a" };
    a.eu = a;
    expect(() => log.info("e", "m", { a })).not.toThrow();
    const r = capturado[0]! as unknown as { a: { nome: string; eu: string } };
    expect(r.a.nome).toBe("a");
    expect(r.a.eu).toBe("[circular]");
  });

  it("a linha serializa para JSON de uma linha", () => {
    log.error("e", "m", { err: new Error("boom"), n: 1n, quando: new Date(0) });
    const linha = JSON.stringify(capturado[0]);
    expect(linha).not.toContain("\n");
    expect(JSON.parse(linha).n).toBe("1n");
    expect(JSON.parse(linha).quando).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("erro", () => {
  it("Error vira {nome, mensagem, stack}", () => {
    const e = new TypeError("faltou x");
    log.error("e", "falhou", { err: e });
    const r = capturado[0]!;
    expect(r.err?.nome).toBe("TypeError");
    expect(r.err?.mensagem).toBe("faltou x");
    expect(r.err?.stack).toContain("TypeError");
  });

  it("captura o `code` de erro de Node/Prisma", () => {
    const e = Object.assign(new Error("dir import"), { code: "ERR_UNSUPPORTED_DIR_IMPORT" });
    expect(serializarErro(e).codigo).toBe("ERR_UNSUPPORTED_DIR_IMPORT");
  });

  it("um throw que nao e Error ainda vira algo util", () => {
    log.error("e", "estranho", { err: "so uma string" });
    expect(capturado[0]!.err).toEqual({ nome: "NaoErro", mensagem: "so uma string" });
  });
});

describe("bindings e contexto", () => {
  it("filho carrega os bindings em toda linha e empilha", () => {
    const slog = log.filho({ socketId: "s1", userId: "u1" });
    slog.info("gateway.evento", "recebido");
    const filhoDoFilho = slog.filho({ canalId: "c1" });
    filhoDoFilho.warn("gateway.voz", "lento");

    expect(capturado[0]).toMatchObject({ socketId: "s1", userId: "u1" });
    expect(capturado[1]).toMatchObject({ socketId: "s1", userId: "u1", canalId: "c1" });
  });

  it("precedencia: campo da chamada > binding do filho > contexto ambiente", () => {
    comContexto({ userId: "ambiente", requisicaoId: "req-1" }, () => {
      const slog = log.filho({ userId: "filho" });
      slog.info("e", "m", { userId: "chamada" });
      slog.info("e", "m2");
    });
    expect(capturado[0]).toMatchObject({ userId: "chamada", requisicaoId: "req-1" });
    expect(capturado[1]).toMatchObject({ userId: "filho", requisicaoId: "req-1" });
  });

  it("comContexto sobrevive a await e a funcao chamada em profundidade", async () => {
    async function trabalhoProfundo() {
      await Promise.resolve();
      log.info("servico.passo", "no fundo");
    }
    await comContexto({ requisicaoId: "req-async" }, async () => {
      await trabalhoProfundo();
    });
    expect(capturado[0]).toMatchObject({ requisicaoId: "req-async" });
  });

  it("comContexto aninhado funde, nao substitui", () => {
    comContexto({ userId: "u" }, () => {
      comContexto({ serverId: "s" }, () => {
        log.info("e", "m");
      });
    });
    expect(capturado[0]).toMatchObject({ userId: "u", serverId: "s" });
  });

  it("contextoAtual entrega uma copia do ambiente para repassar", () => {
    comContexto({ userId: "u", rota: "acao" }, () => {
      const ctx = contextoAtual();
      expect(ctx).toEqual({ userId: "u", rota: "acao" });
      ctx.userId = "mexido";
    });
    // mexer na copia nao contamina o proximo log
    comContexto({ userId: "u" }, () => log.info("e", "m"));
    expect(capturado[0]!.userId).toBe("u");
  });
});

describe("logar nunca propaga falha", () => {
  it("destino que lanca nao derruba quem chamou log", () => {
    configurarLog({
      destino: () => {
        throw new Error("disco cheio");
      },
    });
    expect(() => log.error("e", "importante")).not.toThrow();
  });

  it("sink que lanca (Sentry fora do ar) nao propaga; os outros ainda rodam", () => {
    const vistos: string[] = [];
    configurarLog({ sink: () => vistos.push("a") });
    configurarLog({
      sink: () => {
        throw new Error("sentry 503");
      },
    });
    configurarLog({ sink: () => vistos.push("c") });

    expect(() => log.warn("e", "m")).not.toThrow();
    expect(vistos).toEqual(["a", "c"]);
  });

  it("sink recebe o mesmo registro ja redigido", () => {
    let recebido: RegistroDeLog | null = null;
    configurarLog({ sink: (r) => (recebido = r) });
    log.info("e", "m", { senha: "x" });
    expect((recebido as unknown as Record<string, string>).senha).toBe("[redigido]");
  });
});

describe("capturarFalhasDoProcesso", () => {
  it("loga unhandledRejection como error estruturado, sem encerrar", () => {
    const alvo = new EventEmitter();
    let saiu = false;
    capturarFalhasDoProcesso({ alvo, aoSair: () => (saiu = true) });

    alvo.emit("unhandledRejection", new Error("fetch caiu"));

    expect(capturado).toHaveLength(1);
    expect(capturado[0]!.evento).toBe("processo.promessa_nao_tratada");
    expect(capturado[0]!.nivel).toBe("error");
    expect(capturado[0]!.err?.mensagem).toBe("fetch caiu");
    expect(saiu).toBe(false);
  });

  it("uncaughtException loga e encerra", () => {
    const alvo = new EventEmitter();
    let saiu = false;
    capturarFalhasDoProcesso({ alvo, aoSair: () => (saiu = true) });

    alvo.emit("uncaughtException", new Error("estado corrompido"));

    expect(capturado[0]!.evento).toBe("processo.excecao_nao_capturada");
    expect(saiu).toBe(true);
  });

  it("sairNoUncaught: false loga mas nao encerra", () => {
    const alvo = new EventEmitter();
    let saiu = false;
    capturarFalhasDoProcesso({
      alvo,
      sairNoUncaught: false,
      aoSair: () => (saiu = true),
    });
    alvo.emit("uncaughtException", new Error("x"));
    expect(capturado).toHaveLength(1);
    expect(saiu).toBe(false);
  });

  it("idempotente: a segunda chamada nao registra outro par de handlers", () => {
    const alvo = new EventEmitter();
    capturarFalhasDoProcesso({ alvo, aoSair: () => {} });
    capturarFalhasDoProcesso({ alvo, aoSair: () => {} });
    expect(alvo.listenerCount("unhandledRejection")).toBe(1);
    expect(alvo.listenerCount("uncaughtException")).toBe(1);
  });
});
