import { describe, expect, it } from "vitest";
import {
  SELECT_USUARIO_PUBLICO,
  toPublicUser,
  type UserRow,
} from "@aether/shared";

/**
 * A traducao de "linha do banco" para "usuario que a tela desenha".
 *
 * Vale teste porque este e o unico ponto por onde o plano de alguem chega a
 * tela de OUTRA pessoa. Antes dele, nove consultas montavam esse objeto a mao;
 * qualquer uma que esquecesse o plano deixaria o assinante sem selo em uma
 * tela so — e o defeito nao aparece como erro, so como ausencia.
 */

const BASE: UserRow = {
  id: "u1",
  username: "ryan",
  displayName: "Ryan",
  avatarUrl: null,
  status: "ONLINE",
  molduraId: null,
  assinatura: null,
};

const HOJE = new Date("2026-08-15T00:00:00Z");
const ONTEM = new Date("2026-08-01T00:00:00Z");
const AMANHA = new Date("2026-09-01T00:00:00Z");

describe("o perfil basico atravessa intacto", () => {
  it("copia identidade e status", () => {
    const u = toPublicUser({ ...BASE, avatarUrl: "https://x/y.png" }, HOJE);
    expect(u.id).toBe("u1");
    expect(u.username).toBe("ryan");
    expect(u.displayName).toBe("Ryan");
    expect(u.avatarUrl).toBe("https://x/y.png");
    expect(u.status).toBe("ONLINE");
  });

  /**
   * `status` chega como string do banco. Valor fora do conjunto conhecido vira
   * OFFLINE em vez de vazar cru — a tela usa esse campo para escolher cor e
   * icone, e um valor inesperado apagaria o indicador sem dizer por que.
   */
  it("status desconhecido vira OFFLINE", () => {
    expect(toPublicUser({ ...BASE, status: "INVENTADO" }, HOJE).status).toBe(
      "OFFLINE",
    );
    expect(toPublicUser({ ...BASE, status: "" }, HOJE).status).toBe("OFFLINE");
  });

  it("os status validos sao preservados", () => {
    for (const s of ["ONLINE", "IDLE", "DND", "OFFLINE"]) {
      expect(toPublicUser({ ...BASE, status: s }, HOJE).status).toBe(s);
    }
  });
});

describe("o plano que a tela recebe", () => {
  it("sem assinatura, e gratuito", () => {
    expect(toPublicUser(BASE, HOJE).plano).toBe("FREE");
  });

  it("assinatura no prazo aparece", () => {
    const u = toPublicUser(
      { ...BASE, assinatura: { tier: "PLUS", expiraEm: AMANHA } },
      HOJE,
    );
    expect(u.plano).toBe("PLUS");
  });

  it("concessao sem validade vale para sempre", () => {
    const u = toPublicUser(
      { ...BASE, assinatura: { tier: "PRO", expiraEm: null } },
      HOJE,
    );
    expect(u.plano).toBe("PRO");
  });

  /**
   * O CASO QUE MOTIVA O TESTE: o vencimento tem de valer AQUI tambem.
   *
   * Enquanto o plano so aparecia na propria tela de configuracoes, um lugar
   * esquecer de expirar era um bug de uma tela. Agora o plano viaja para todo
   * mundo — um lugar que nao expira mostra assinante vencido como ativo para o
   * servidor inteiro, e ninguem reclama, porque o erro favorece quem tem.
   */
  it("assinatura VENCIDA nao vira selo", () => {
    const u = toPublicUser(
      { ...BASE, assinatura: { tier: "PRO", expiraEm: ONTEM } },
      HOJE,
    );
    expect(u.plano).toBe("FREE");
  });

  it("aceita data em texto, como vem de JSON", () => {
    const u = toPublicUser(
      { ...BASE, assinatura: { tier: "PLUS", expiraEm: AMANHA.toISOString() } },
      HOJE,
    );
    expect(u.plano).toBe("PLUS");
  });
});

/**
 * O seletor e o formato cru precisam continuar falando da mesma coisa.
 *
 * Sem este bloco, remover `assinatura` do `select` compilaria — o campo e
 * opcional no `select` do Prisma — e TODO MUNDO viraria gratuito de uma vez,
 * silenciosamente. E a falha mais cara possivel deste arquivo, entao fica
 * fixada.
 */
describe("o seletor cobre o formato cru", () => {
  it("pede a assinatura ao banco", () => {
    expect(SELECT_USUARIO_PUBLICO.assinatura).toEqual({
      select: { tier: true, expiraEm: true },
    });
  });

  it("pede todo campo que o formato cru declara", () => {
    const doSeletor = Object.keys(SELECT_USUARIO_PUBLICO).sort();
    const doFormato = Object.keys(BASE).sort();
    expect(doSeletor).toEqual(doFormato);
  });

  /**
   * Nada alem do necessario: provedor, id externo e quem concedeu ficam no
   * banco. Sao dados de cobranca e de auditoria, e nao teriam por que
   * atravessar a rede ate o navegador de outra pessoa.
   */
  it("nao arrasta dado de cobranca junto", () => {
    const assinatura = SELECT_USUARIO_PUBLICO.assinatura.select as Record<
      string,
      unknown
    >;
    for (const campo of ["provedor", "idExterno", "concedidoPor", "motivo"]) {
      expect(assinatura[campo]).toBeUndefined();
    }
  });
});
