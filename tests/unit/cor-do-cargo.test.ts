import { describe, expect, it } from "vitest";
import {
  corDoCargoPrincipal,
  COR_CARGO_PADRAO,
  type PublicRole,
} from "@aether/shared";

/**
 * `corDoCargoPrincipal` decide UMA cor por pessoa para o painel de membros E o
 * chat — os dois tem que sempre concordar (era exatamente o problema
 * reportado: a cor so aparecia na lateral). Vale travar a regra de qual cargo
 * "ganha": o mais alto que NAO e o padrao (@everyone), nunca o padrao em si
 * quando ha outro disponivel.
 */

const role = (over: Partial<PublicRole> & { id: string }): PublicRole => ({
  name: over.id,
  color: "#000000",
  position: 0,
  isDefault: false,
  isOwner: false,
  permissions: "0",
  ...over,
});

describe("corDoCargoPrincipal", () => {
  it("sem cargo nenhum -> cor padrao", () => {
    expect(corDoCargoPrincipal([])).toBe(COR_CARGO_PADRAO);
  });

  it("so o cargo padrao -> usa a cor dele mesmo assim", () => {
    const membros = role({ id: "everyone", isDefault: true, color: "#9AA6B8" });
    expect(corDoCargoPrincipal([membros])).toBe("#9AA6B8");
  });

  it("cargo alto colorido + o padrao -> a do cargo alto, nao a do padrao", () => {
    // ja vem ordenado por position DESC, como PublicMember.roles sempre vem
    const dono = role({ id: "dono", color: "#22c55e", position: 100 });
    const everyone = role({ id: "everyone", isDefault: true, color: "#9AA6B8" });
    expect(corDoCargoPrincipal([dono, everyone])).toBe("#22c55e");
  });

  it("dois cargos nao-padrao -> o de posicao mais alta (primeiro da lista)", () => {
    const admin = role({ id: "admin", color: "#3b82f6", position: 50 });
    const moderador = role({ id: "mod", color: "#f59e0b", position: 20 });
    // a ordem JA vem por position desc — a funcao nao reordena, so escolhe o primeiro
    expect(corDoCargoPrincipal([admin, moderador])).toBe("#3b82f6");
  });
});
