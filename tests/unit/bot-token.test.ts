import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Token de bot — geracao, hash e resolucao (Etapa 4 da Developer Platform).
 *
 * Propriedades travadas:
 *  - lixo (nao-string, sem prefixo `aeb_`) resolve `null` SEM tocar o banco;
 *  - token desconhecido / revogado / de app bloqueada / de bot nao habilitado
 *    resolve `null`;
 *  - token valido resolve `{ applicationId, botUserId }` e marca `lastUsedAt`;
 *  - o banco guarda `sha256(token)`, nunca o token; o `prefixo` e um recorte.
 */

const botTokenFindUnique = vi.fn();
const botTokenUpdate = vi.fn().mockResolvedValue({});

vi.mock("@aether/db", () => ({
  prisma: {
    botToken: {
      findUnique: botTokenFindUnique,
      update: botTokenUpdate,
    },
  },
}));

const {
  resolveBotToken,
  gerarTokenDeBot,
  hashDoTokenDeBot,
  PREFIXO_TOKEN_BOT,
} = await import("../../packages/access/src/bot-token");

beforeEach(() => {
  botTokenFindUnique.mockReset();
  botTokenUpdate.mockReset().mockResolvedValue({});
});

const linhaValida = (over: Record<string, unknown> = {}) => ({
  applicationId: "app_1",
  revokedAt: null,
  application: { blockedAt: null, botUserId: "u_bot_1" },
  ...over,
});

describe("gerarTokenDeBot", () => {
  it("token comeca com aeb_ e o prefixo/hash batem", () => {
    const { token, tokenHash, prefixo } = gerarTokenDeBot();
    expect(token.startsWith(PREFIXO_TOKEN_BOT)).toBe(true);
    expect(token.length).toBeGreaterThan(40);
    expect(prefixo).toBe(token.slice(0, 12));
    expect(tokenHash).toBe(hashDoTokenDeBot(token));
  });

  it("dois tokens sao diferentes", () => {
    expect(gerarTokenDeBot().token).not.toBe(gerarTokenDeBot().token);
  });
});

describe("hashDoTokenDeBot", () => {
  it("e deterministico e sha256 hex (64 chars)", () => {
    const h = hashDoTokenDeBot("aeb_abc");
    expect(h).toBe(hashDoTokenDeBot("aeb_abc"));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe(hashDoTokenDeBot("aeb_abd"));
  });
});

describe("resolveBotToken — recusa sem tocar o banco", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["vazio", ""],
    ["sem prefixo", "xoxb-1234"],
    ["prefixo de sessao", "Bearer aeb_x"],
  ])("%s -> null e findUnique nao chamado", async (_rotulo, entrada) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await resolveBotToken(entrada as any)).toBeNull();
    expect(botTokenFindUnique).not.toHaveBeenCalled();
  });
});

describe("resolveBotToken — com o banco", () => {
  it("token valido resolve a identidade e marca lastUsedAt", async () => {
    botTokenFindUnique.mockResolvedValue(linhaValida());

    const id = await resolveBotToken("aeb_tokenvalido");
    expect(id).toEqual({ applicationId: "app_1", botUserId: "u_bot_1" });

    // procurou pelo HASH, nunca pelo token cru
    const arg = botTokenFindUnique.mock.calls[0]![0];
    expect(arg.where.tokenHash).toBe(hashDoTokenDeBot("aeb_tokenvalido"));
    expect(arg.where.tokenHash).not.toBe("aeb_tokenvalido");

    expect(botTokenUpdate).toHaveBeenCalledWith({
      where: { tokenHash: hashDoTokenDeBot("aeb_tokenvalido") },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it("token desconhecido -> null", async () => {
    botTokenFindUnique.mockResolvedValue(null);
    expect(await resolveBotToken("aeb_naoexiste")).toBeNull();
    expect(botTokenUpdate).not.toHaveBeenCalled();
  });

  it("token revogado -> null", async () => {
    botTokenFindUnique.mockResolvedValue(linhaValida({ revokedAt: new Date() }));
    expect(await resolveBotToken("aeb_revogado")).toBeNull();
    expect(botTokenUpdate).not.toHaveBeenCalled();
  });

  it("aplicacao bloqueada -> null", async () => {
    botTokenFindUnique.mockResolvedValue(
      linhaValida({ application: { blockedAt: new Date(), botUserId: "u_bot_1" } }),
    );
    expect(await resolveBotToken("aeb_bloqueado")).toBeNull();
  });

  it("bot nao habilitado (botUserId nulo) -> null", async () => {
    botTokenFindUnique.mockResolvedValue(
      linhaValida({ application: { blockedAt: null, botUserId: null } }),
    );
    expect(await resolveBotToken("aeb_semidentidade")).toBeNull();
  });

  it("falha ao marcar lastUsedAt NAO derruba o resolve", async () => {
    botTokenFindUnique.mockResolvedValue(linhaValida());
    botTokenUpdate.mockRejectedValue(new Error("db fora"));
    expect(await resolveBotToken("aeb_ok")).toEqual({
      applicationId: "app_1",
      botUserId: "u_bot_1",
    });
  });
});
