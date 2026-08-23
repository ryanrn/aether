import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampVolume,
  DEFAULT_VOLUME,
  readScreenVolume,
  readUserVolumes,
  saveScreenVolume,
  saveUserVolume,
} from "../../apps/web/src/lib/voice/volumes";

/**
 * Volume por pessoa e da tela.
 *
 * E preferencia local guardada no localStorage, entao o que importa testar e
 * a resiliencia: o conteudo desse armazenamento e editavel pelo usuario e
 * sobrevive a versoes do app. Um valor estranho ali nao pode virar exceção no
 * meio de uma call — `HTMLMediaElement.volume` lanca IndexSizeError para
 * qualquer coisa fora de 0..1.
 */

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clampVolume", () => {
  it("mantem valores validos", () => {
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(1)).toBe(1);
  });

  it("corta acima de 1 e abaixo de 0", () => {
    /**
     * O teto de 1 nao e estetico: `element.volume = 1.5` lanca IndexSizeError
     * e derrubaria o audio da call inteira.
     */
    expect(clampVolume(2)).toBe(1);
    expect(clampVolume(-1)).toBe(0);
  });

  it("devolve o padrao para valor que nao e numero utilizavel", () => {
    expect(clampVolume(NaN)).toBe(DEFAULT_VOLUME);
    expect(clampVolume(Infinity)).toBe(1);
  });
});

describe("volume por usuario", () => {
  it("guarda e le de volta", () => {
    saveUserVolume("usuario-1", 0.4);
    expect(readUserVolumes()["usuario-1"]).toBe(0.4);
  });

  it("APAGA a entrada quando volta ao padrao", () => {
    /**
     * Sem isso o armazenamento cresceria com uma entrada por pessoa que a
     * gente ja ouviu, todas dizendo "100%" — que e o valor de quem nunca
     * mexeu em nada.
     */
    saveUserVolume("usuario-1", 0.4);
    saveUserVolume("usuario-1", DEFAULT_VOLUME);
    expect(readUserVolumes()).not.toHaveProperty("usuario-1");
  });

  it("guarda cada pessoa separadamente", () => {
    saveUserVolume("alto", 0.3);
    saveUserVolume("baixo", 1);
    saveUserVolume("medio", 0.7);
    const all = readUserVolumes();
    expect(all["alto"]).toBe(0.3);
    expect(all["medio"]).toBe(0.7);
    // 1 e o padrao, entao nao fica guardado
    expect(all).not.toHaveProperty("baixo");
  });

  it("corta valor fora da faixa ao guardar", () => {
    saveUserVolume("usuario-1", 5);
    expect(readUserVolumes()["usuario-1"]).toBe(1);
  });

  it("ignora JSON corrompido em vez de lancar", () => {
    storage.setItem("aether.volumes.users", "{isso nao e json");
    expect(readUserVolumes()).toEqual({});
  });

  it("descarta entradas que nao sao numero", () => {
    storage.setItem(
      "aether.volumes.users",
      JSON.stringify({ bom: 0.5, ruim: "alto", pior: null }),
    );
    expect(readUserVolumes()).toEqual({ bom: 0.5 });
  });

  it("corta valores fora da faixa vindos do armazenamento", () => {
    storage.setItem(
      "aether.volumes.users",
      JSON.stringify({ exagerado: 99, negativo: -3 }),
    );
    expect(readUserVolumes()).toEqual({ exagerado: 1, negativo: 0 });
  });
});

describe("volume da tela", () => {
  it("comeca no padrao quando nunca foi definido", () => {
    expect(readScreenVolume()).toBe(DEFAULT_VOLUME);
  });

  it("guarda e le de volta", () => {
    saveScreenVolume(0.25);
    expect(readScreenVolume()).toBe(0.25);
  });

  it("aceita zero — silenciar a tela e um valor legitimo, nao ausencia", () => {
    saveScreenVolume(0);
    expect(readScreenVolume()).toBe(0);
  });

  it("cai no padrao se o valor guardado nao for numero", () => {
    storage.setItem("aether.volumes.screen", "muito alto");
    expect(readScreenVolume()).toBe(DEFAULT_VOLUME);
  });
});

describe("armazenamento indisponivel", () => {
  it("nao lanca quando o localStorage recusa escrever", () => {
    /** Modo anonimo com storage bloqueado: o volume vale so nesta sessao. */
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    expect(() => saveUserVolume("usuario-1", 0.5)).not.toThrow();
    expect(() => saveScreenVolume(0.5)).not.toThrow();
  });
});
