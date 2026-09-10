import { describe, expect, it } from "vitest";
import {
  SELECT_USUARIO_PUBLICO,
  toPublicUser,
  type PlanTier,
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
  avatarEstaticoUrl: null,
  status: "ONLINE",
  molduraId: null,
  decoracao: null,
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

/**
 * O AVATAR ANIMADO CONTRA O PLANO — a simetria com a moldura.
 *
 * A regra e a mesma dos dois cosmeticos: perder o plano tira o que era do
 * plano, sem destruir nada. A moldura para de desenhar e a escolha fica; o
 * avatar para de animar e o arquivo fica.
 *
 * A alternativa — seguir animando — daria de graca, para sempre, o unico
 * recurso visivel que separa o plano de cima. A outra alternativa, apagar o
 * arquivo, destruiria dado da pessoa por causa de uma cobranca vencida.
 */
describe("avatar animado contra o plano", () => {
  const ANIMADO = "https://x/y/animado.gif";
  const PARADO = "https://x/y/parado.png";
  const comAvatar = (tier: PlanTier | null) => ({
    ...BASE,
    avatarUrl: ANIMADO,
    avatarEstaticoUrl: PARADO,
    assinatura: tier ? { tier, expiraEm: null } : null,
  });

  it("o Olimpo Pro ve a animacao", () => {
    expect(toPublicUser(comAvatar("PRO"), HOJE).avatarUrl).toBe(ANIMADO);
  });

  it("sem o plano de cima, cai para a versao parada", () => {
    expect(toPublicUser(comAvatar("PLUS"), HOJE).avatarUrl).toBe(PARADO);
    expect(toPublicUser(comAvatar(null), HOJE).avatarUrl).toBe(PARADO);
  });

  /**
   * O caso que a assimetria anterior deixava passar: assinatura vencida
   * continuava animando ate alguem mexer na linha.
   */
  it("assinatura VENCIDA para de animar sozinha", () => {
    const vencido = {
      ...BASE,
      avatarUrl: ANIMADO,
      avatarEstaticoUrl: PARADO,
      assinatura: { tier: "PRO" as PlanTier, expiraEm: ONTEM },
    };
    expect(toPublicUser(vencido, HOJE).avatarUrl).toBe(PARADO);
  });

  /**
   * Quem nunca enviou animacao nao tem gemeo parado. A regra precisa valer
   * para essa pessoa tambem, sem apagar a foto dela.
   */
  it("avatar comum aparece em qualquer plano", () => {
    const comum = { ...BASE, avatarUrl: "https://x/y/foto.png", avatarEstaticoUrl: null };
    expect(toPublicUser({ ...comum, assinatura: null }, HOJE).avatarUrl).toBe(
      "https://x/y/foto.png",
    );
    expect(
      toPublicUser({ ...comum, assinatura: { tier: "PRO", expiraEm: null } }, HOJE)
        .avatarUrl,
    ).toBe("https://x/y/foto.png");
  });

  it("sem avatar nenhum continua sem avatar", () => {
    expect(toPublicUser(BASE, HOJE).avatarUrl).toBeNull();
  });

  /**
   * NADA E APAGADO. O teste olha o que entra, e nao so o que sai: o dado
   * animado precisa continuar na linha para o plano reativado devolve-lo.
   */
  it("a linha guarda os DOIS, para reativar devolver o movimento", () => {
    const linha = comAvatar("PLUS");
    toPublicUser(linha, HOJE);
    expect(linha.avatarUrl).toBe(ANIMADO);
    expect(linha.avatarEstaticoUrl).toBe(PARADO);
    // e ao voltar o plano, a animacao volta sem novo envio
    expect(toPublicUser({ ...linha, assinatura: { tier: "PRO", expiraEm: null } }, HOJE)
      .avatarUrl).toBe(ANIMADO);
  });
});
