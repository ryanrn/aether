import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isAudioSourceError,
  readShareAudioPreference,
  saveShareAudioPreference,
} from "../../apps/web/src/lib/voice/screen-share";

/**
 * Som do sistema no compartilhamento de tela.
 *
 * Contexto: `getDisplayMedia` e TUDO-OU-NADA com audio — nao existe "som se
 * der, mas nao falhe". Quando o sistema recusa abrir a captura de som, a
 * captura INTEIRA falha, video junto. A versao antiga descobria isso tentando
 * e refazendo sem audio, o que reabria o seletor nativo do navegador.
 *
 * Agora a escolha vem antes, e a deteccao do erro decide se desligamos a opcao
 * sozinhos. Estas duas pecas sao logica pura, e sao o que este arquivo cobre.
 */

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
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

describe("preferencia de levar o som", () => {
  it("vem LIGADA por padrao", () => {
    /** Levar o som e o que a maioria espera ao compartilhar um video ou jogo. */
    expect(readShareAudioPreference()).toBe(true);
  });

  it("guarda o desligamento e o le de volta", () => {
    saveShareAudioPreference(false);
    expect(readShareAudioPreference()).toBe(false);
  });

  it("religa quando a pessoa marca de novo", () => {
    saveShareAudioPreference(false);
    saveShareAudioPreference(true);
    expect(readShareAudioPreference()).toBe(true);
  });

  it("valor estranho no storage cai no padrao ligado", () => {
    storage.setItem("aether.share.systemAudio", "talvez");
    expect(readShareAudioPreference()).toBe(true);
  });

  it("nao lanca quando o storage esta bloqueado", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("SecurityError");
        },
      },
    });
    expect(readShareAudioPreference()).toBe(true);
    expect(() => saveShareAudioPreference(false)).not.toThrow();
  });
});

describe("isAudioSourceError", () => {
  it("reconhece NotReadableError", () => {
    /**
     * O erro que o Chrome lanca quando nao consegue abrir a fonte de som —
     * tipicamente outro programa segurando o audio em modo exclusivo.
     */
    const error = new Error("Could not start audio source");
    error.name = "NotReadableError";
    expect(isAudioSourceError(error)).toBe(true);
  });

  it("reconhece pela mensagem, mesmo com outro nome", () => {
    /** Navegadores diferentes nomeiam diferente; a mensagem e mais estavel. */
    expect(isAudioSourceError(new Error("Could not start audio source"))).toBe(true);
    expect(isAudioSourceError(new Error("Failed to start audio capture"))).toBe(true);
  });

  it("NAO confunde com o usuario cancelando o seletor", () => {
    /**
     * Distinguir importa: cancelar e escolha, e nao deve desligar a
     * preferencia de som de ninguem.
     */
    const cancel = new Error("Permission denied");
    cancel.name = "NotAllowedError";
    expect(isAudioSourceError(cancel)).toBe(false);
  });

  it("NAO confunde com falha de video", () => {
    const video = new Error("no video track found");
    expect(isAudioSourceError(video)).toBe(false);
  });

  it("lida com o que nao e Error", () => {
    expect(isAudioSourceError("Could not start audio source")).toBe(false);
    expect(isAudioSourceError(null)).toBe(false);
    expect(isAudioSourceError(undefined)).toBe(false);
  });
});
