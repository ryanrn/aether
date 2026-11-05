import { describe, expect, it } from "vitest";
import { reposicionar, type PublicCategory, type PublicChannel } from "@aether/shared";
import { moverCanalNaArvore } from "../../apps/web/src/lib/channels/mover-na-arvore";

/**
 * Mover canal na arvore — a tela mostra a ordem nova NA HORA (antes do
 * servidor responder) e o servidor grava a mesma ordem. O que estes testes
 * travam: as duas contas sao a mesma (`reposicionar`), e a arvore otimista
 * nao perde nem duplica canal.
 */

const canal = (id: string, categoryId: string | null): PublicChannel =>
  ({ id, name: id, type: "TEXT", categoryId, position: 0 }) as unknown as PublicChannel;

const categoria = (id: string, canais: string[]): PublicCategory =>
  ({ id, name: id, position: 0, channels: canais.map((c) => canal(c, id)) }) as unknown as PublicCategory;

const arvore = () => ({
  looseChannels: [canal("s1", null), canal("s2", null)],
  categories: [categoria("A", ["a1", "a2", "a3"]), categoria("B", ["b1"])],
});

const ids = (lista: { id: string }[]) => lista.map((c) => c.id);

describe("reposicionar (a conta do servidor E da tela)", () => {
  it("move para cima e para baixo dentro da lista", () => {
    expect(reposicionar(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(reposicionar(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
  });

  it("indice fora da lista vai para a ponta, sem quebrar", () => {
    expect(reposicionar(["a", "b"], "a", 99)).toEqual(["b", "a"]);
    expect(reposicionar(["a", "b"], "b", -3)).toEqual(["b", "a"]);
  });

  it("item que vem de fora entra no indice pedido", () => {
    expect(reposicionar(["a", "b"], "x", 1)).toEqual(["a", "x", "b"]);
  });
});

describe("moverCanalNaArvore", () => {
  it("reordena dentro da mesma categoria", () => {
    const nova = moverCanalNaArvore(arvore(), "a3", "A", 0);
    expect(ids(nova.categories[0]!.channels)).toEqual(["a3", "a1", "a2"]);
  });

  it("muda de categoria: sai da origem, entra no destino com a categoria nova", () => {
    const nova = moverCanalNaArvore(arvore(), "a1", "B", 1);
    expect(ids(nova.categories[0]!.channels)).toEqual(["a2", "a3"]);
    expect(ids(nova.categories[1]!.channels)).toEqual(["b1", "a1"]);
    expect(nova.categories[1]!.channels[1]!.categoryId).toBe("B");
  });

  it("canal solto vai para categoria e vice-versa", () => {
    const paraCategoria = moverCanalNaArvore(arvore(), "s1", "B", 0);
    expect(ids(paraCategoria.looseChannels)).toEqual(["s2"]);
    expect(ids(paraCategoria.categories[1]!.channels)).toEqual(["s1", "b1"]);

    const paraSoltos = moverCanalNaArvore(arvore(), "b1", null, 0);
    expect(ids(paraSoltos.looseChannels)).toEqual(["b1", "s1", "s2"]);
    expect(paraSoltos.looseChannels[0]!.categoryId).toBeNull();
  });

  it("nunca perde nem duplica canal", () => {
    const antes = arvore();
    const total = (a: typeof antes) =>
      [...ids(a.looseChannels), ...a.categories.flatMap((c) => ids(c.channels))].sort();
    const nova = moverCanalNaArvore(antes, "a2", "B", 0);
    expect(total(nova)).toEqual(total(antes));
  });

  it("nao mexe na arvore original (e ela que volta se o servidor recusar)", () => {
    const antes = arvore();
    const copia = JSON.stringify(antes);
    moverCanalNaArvore(antes, "a1", "B", 0);
    expect(JSON.stringify(antes)).toBe(copia);
  });

  it("canal ou categoria desconhecidos: devolve a arvore como estava", () => {
    const antes = arvore();
    expect(moverCanalNaArvore(antes, "nao-existe", "A", 0)).toBe(antes);
    expect(moverCanalNaArvore(antes, "a1", "categoria-fantasma", 0)).toBe(antes);
  });
});
