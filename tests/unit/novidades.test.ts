import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  marcarComoVista,
  novidadesDaVersao,
  novidadesParaMostrar,
} from "@/lib/novidades";

/**
 * Regra de quando a tela "Veja o que mudou" aparece.
 *
 * O caso que mais importa e o TERCEIRO: quem acabou de instalar nao tem "o que
 * mudou". Abrir um changelog na cara de quem chegou agora e ruido, e e um erro
 * facil de cometer (basta tratar "sem valor guardado" como "versao diferente").
 */

const CHAVE = "aether:novidades-vista";

/**
 * `localStorage` de mentira, em memoria.
 *
 * O ambiente dos testes e `node`, sem DOM. Trazer o jsdom inteiro para
 * exercitar duas chamadas de armazenamento seria caro demais pelo que entrega.
 */
function armazenamentoFalso(inicial: Record<string, string> = {}) {
  const mapa = new Map(Object.entries(inicial));
  return {
    getItem: (k: string) => mapa.get(k) ?? null,
    setItem: (k: string, v: string) => void mapa.set(k, v),
    removeItem: (k: string) => void mapa.delete(k),
    clear: () => mapa.clear(),
  };
}

let armazenamento: ReturnType<typeof armazenamentoFalso>;

beforeEach(() => {
  vi.unstubAllGlobals();
  armazenamento = armazenamentoFalso();
  vi.stubGlobal("localStorage", armazenamento);
});

describe("novidadesParaMostrar", () => {
  it("mostra quando a versao instalada mudou desde a ultima vista", () => {
    armazenamento.setItem(CHAVE, "0.1.21");
    expect(novidadesParaMostrar("0.1.22")?.versao).toBe("0.1.22");
  });

  it("nao mostra duas vezes a mesma versao", () => {
    armazenamento.setItem(CHAVE, "0.1.22");
    expect(novidadesParaMostrar("0.1.22")).toBeNull();
  });

  it("nao mostra na PRIMEIRA execucao — e anota a versao em silencio", () => {
    expect(armazenamento.getItem(CHAVE)).toBeNull();
    expect(novidadesParaMostrar("0.1.22")).toBeNull();
    // Anotou: a proxima atualizacao ja mostra normalmente.
    expect(armazenamento.getItem(CHAVE)).toBe("0.1.22");
  });

  it("versao sem entrada no changelog nao abre modal vazio", () => {
    armazenamento.setItem(CHAVE, "0.1.22");
    expect(novidadesParaMostrar("9.9.9")).toBeNull();
  });

  it("sem armazenamento, nao mostra — reapareceria a cada abertura", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("bloqueado");
      },
      setItem() {
        throw new Error("bloqueado");
      },
    });
    expect(() => novidadesParaMostrar("0.1.22")).not.toThrow();
    expect(novidadesParaMostrar("0.1.22")).toBeNull();
  });

  it("marcarComoVista nao lanca quando o armazenamento recusa", () => {
    vi.stubGlobal("localStorage", {
      setItem() {
        throw new Error("bloqueado");
      },
    });
    expect(() => marcarComoVista("0.1.22")).not.toThrow();
  });
});

describe("novidadesDaVersao", () => {
  it("a versao publicada tem resumo e itens", () => {
    const n = novidadesDaVersao("0.1.22");
    expect(n).not.toBeNull();
    expect(n!.resumo.length).toBeGreaterThan(10);
    expect(n!.itens.length).toBeGreaterThan(0);
  });

  it("toda categoria e uma das quatro conhecidas", () => {
    // O componente indexa ICONE/ROTULO pela categoria: uma categoria fora da
    // lista renderizaria icone `undefined`.
    const validas = ["recurso", "performance", "correcao", "seguranca"];
    for (const item of novidadesDaVersao("0.1.22")!.itens) {
      expect(validas).toContain(item.categoria);
    }
  });

  it("data em ISO, para o formatador da tela", () => {
    expect(novidadesDaVersao("0.1.22")!.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
