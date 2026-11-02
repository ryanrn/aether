import { afterEach, describe, expect, it, vi } from "vitest";
import {
  carenciaOfflineMs,
  confirmarSaida,
  type DependenciasDaSaida,
} from "../../apps/realtime/src/carencia-offline";

/**
 * Carencia antes de anunciar offline (G-1). A espera e injetada: o teste
 * controla o que "acontece durante" ela, sem relogio de verdade.
 */

function deps(over: Partial<DependenciasDaSaida> = {}): DependenciasDaSaida {
  return {
    esperar: vi.fn(async () => undefined),
    isConnected: vi.fn(async () => false),
    estaNoServidor: vi.fn(async () => false),
    ...over,
  };
}

afterEach(() => {
  delete process.env.PRESENCA_CARENCIA_MS;
});

describe("confirmarSaida", () => {
  it("nao voltou: anuncia todos os servidores e os amigos", async () => {
    const d = deps();
    const r = await confirmarSaida("u", ["s1", "s2"], 5000, d);
    expect(d.esperar).toHaveBeenCalledWith(5000);
    expect(r).toEqual({ servidores: ["s1", "s2"], totalmenteFora: true });
  });

  it("voltou durante a carencia: nada a anunciar", async () => {
    let conectado = false;
    let presente = false;
    const d = deps({
      // A reconexao acontece DURANTE a espera.
      esperar: vi.fn(async () => {
        conectado = true;
        presente = true;
      }),
      isConnected: vi.fn(async () => conectado),
      estaNoServidor: vi.fn(async () => presente),
    });
    const r = await confirmarSaida("u", ["s1"], 5000, d);
    expect(r).toEqual({ servidores: [], totalmenteFora: false });
  });

  it("voltou conectado mas em outro servidor: anuncia so onde continua ausente", async () => {
    const d = deps({
      isConnected: vi.fn(async () => true),
      estaNoServidor: vi.fn(async (serverId: string) => serverId === "s2"),
    });
    const r = await confirmarSaida("u", ["s1", "s2"], 5000, d);
    expect(r).toEqual({ servidores: ["s1"], totalmenteFora: false });
  });

  it("carencia zero: decide na hora, sem esperar", async () => {
    const d = deps();
    await confirmarSaida("u", ["s1"], 0, d);
    expect(d.esperar).not.toHaveBeenCalled();
  });

  it("a decisao e tomada DEPOIS da espera, nunca antes", async () => {
    const ordem: string[] = [];
    const d = deps({
      esperar: vi.fn(async () => void ordem.push("espera")),
      isConnected: vi.fn(async () => (ordem.push("conectado?"), false)),
      estaNoServidor: vi.fn(async () => (ordem.push("presente?"), false)),
    });
    await confirmarSaida("u", ["s1"], 5000, d);
    expect(ordem[0]).toBe("espera");
  });
});

describe("carenciaOfflineMs", () => {
  it("padrao de 5 s, configuravel, e 0 desliga", () => {
    expect(carenciaOfflineMs()).toBe(5000);
    process.env.PRESENCA_CARENCIA_MS = "8000";
    expect(carenciaOfflineMs()).toBe(8000);
    process.env.PRESENCA_CARENCIA_MS = "0";
    expect(carenciaOfflineMs()).toBe(0);
  });

  it("valor invalido cai no padrao", () => {
    process.env.PRESENCA_CARENCIA_MS = "abc";
    expect(carenciaOfflineMs()).toBe(5000);
    process.env.PRESENCA_CARENCIA_MS = "-1";
    expect(carenciaOfflineMs()).toBe(5000);
  });
});
