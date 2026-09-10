import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Developer Portal — CRUD de Application / bot / token (Etapa 8).
 *
 * Propriedades travadas:
 *  - toda funcao so age no que e do `userId` (`ownerId`) — nao-dono e 404;
 *  - habilitar bot cria `User kind=BOT` e recusa username em uso / bot ja feito;
 *  - gerar token revoga os anteriores vivos e devolve o segredo (uma vez);
 *  - apagar app recusa se ainda instalado em algum servidor.
 */

const appFindMany = vi.fn();
const appFindFirst = vi.fn();
const appCreate = vi.fn();
const appUpdateMany = vi.fn();
const appUpdate = vi.fn();
const appDelete = vi.fn();
const userFindFirst = vi.fn();
const userCreate = vi.fn();
const userDeleteMany = vi.fn();
const botTokenUpdateMany = vi.fn();
const botTokenCreate = vi.fn();

const tx = {
  application: { delete: appDelete, update: appUpdate },
  user: { create: userCreate, deleteMany: userDeleteMany },
  botToken: { updateMany: botTokenUpdateMany, create: botTokenCreate },
};

vi.mock("@aether/db", () => ({
  prisma: {
    application: {
      findMany: appFindMany,
      findFirst: appFindFirst,
      create: appCreate,
      updateMany: appUpdateMany,
    },
    user: { findFirst: userFindFirst },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));

vi.mock("@aether/access", () => ({
  gerarTokenDeBot: () => ({
    token: "aeb_segredo",
    tokenHash: "hash_do_segredo",
    prefixo: "aeb_segred",
  }),
}));

const {
  listarMinhasApps,
  carregarApp,
  criarApp,
  atualizarApp,
  apagarApp,
  habilitarBot,
  gerarTokenDeApp,
  AppInstaladaEmServidores,
  BotJaHabilitado,
  BotNaoHabilitado,
  UsernameEmUso,
} = await import("../../apps/web/src/server/services/aplicativos");

beforeEach(() => {
  for (const m of [
    appFindMany, appFindFirst, appCreate, appUpdateMany, appUpdate, appDelete,
    userFindFirst, userCreate, userDeleteMany, botTokenUpdateMany, botTokenCreate,
  ]) {
    m.mockReset();
  }
  userCreate.mockResolvedValue({ id: "u_bot_novo" });
});

describe("listarMinhasApps", () => {
  it("mapeia botHabilitado e instalacoes", async () => {
    appFindMany.mockResolvedValue([
      { id: "a1", name: "Um", avatarUrl: null, botUserId: "u1", _count: { installations: 2 } },
      { id: "a2", name: "Dois", avatarUrl: null, botUserId: null, _count: { installations: 0 } },
    ]);
    expect(await listarMinhasApps("u_dono")).toEqual([
      { id: "a1", name: "Um", avatarUrl: null, botHabilitado: true, instalacoes: 2 },
      { id: "a2", name: "Dois", avatarUrl: null, botHabilitado: false, instalacoes: 0 },
    ]);
  });
});

describe("carregarApp", () => {
  it("nao e seu -> null", async () => {
    appFindFirst.mockResolvedValue(null);
    expect(await carregarApp("a1", "u_outro")).toBeNull();
  });
});

describe("atualizarApp", () => {
  it("count 0 -> null; count 1 -> ok", async () => {
    appUpdateMany.mockResolvedValueOnce({ count: 0 });
    expect(await atualizarApp({ appId: "a", userId: "u", name: "X" })).toBeNull();
    appUpdateMany.mockResolvedValueOnce({ count: 1 });
    expect(await atualizarApp({ appId: "a", userId: "u", name: "X" })).toEqual({ ok: true });
  });
});

describe("apagarApp", () => {
  it("nao encontrado -> removido:false", async () => {
    appFindFirst.mockResolvedValue(null);
    expect(await apagarApp("a", "u")).toEqual({ removido: false });
  });

  it("ainda instalado -> lanca AppInstaladaEmServidores", async () => {
    appFindFirst.mockResolvedValue({ botUserId: "u_bot", _count: { installations: 1 } });
    await expect(apagarApp("a", "u")).rejects.toBeInstanceOf(AppInstaladaEmServidores);
  });

  it("livre -> apaga app + a linha User do bot", async () => {
    appFindFirst.mockResolvedValue({ botUserId: "u_bot", _count: { installations: 0 } });
    const r = await apagarApp("a", "u");
    expect(r).toEqual({ removido: true });
    expect(appDelete).toHaveBeenCalledWith({ where: { id: "a" } });
    expect(userDeleteMany).toHaveBeenCalledWith({ where: { id: "u_bot", kind: "BOT" } });
  });
});

describe("habilitarBot", () => {
  it("nao e seu -> null", async () => {
    appFindFirst.mockResolvedValue(null);
    expect(
      await habilitarBot({ appId: "a", userId: "u", username: "x", displayName: "X" }),
    ).toBeNull();
  });

  it("ja tem bot -> BotJaHabilitado", async () => {
    appFindFirst.mockResolvedValue({ id: "a", botUserId: "ja_tem" });
    await expect(
      habilitarBot({ appId: "a", userId: "u", username: "x", displayName: "X" }),
    ).rejects.toBeInstanceOf(BotJaHabilitado);
  });

  it("username em uso -> UsernameEmUso", async () => {
    appFindFirst.mockResolvedValue({ id: "a", botUserId: null });
    userFindFirst.mockResolvedValue({ id: "alguem" });
    await expect(
      habilitarBot({ appId: "a", userId: "u", username: "Ryan", displayName: "X" }),
    ).rejects.toBeInstanceOf(UsernameEmUso);
  });

  it("ok -> cria User kind=BOT minusculo e aponta botUserId", async () => {
    appFindFirst.mockResolvedValue({ id: "a", botUserId: null });
    userFindFirst.mockResolvedValue(null);
    const r = await habilitarBot({
      appId: "a", userId: "u", username: "AETHER-Music", displayName: "AETHER Music",
    });
    expect(r).toEqual({ botUserId: "u_bot_novo" });
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          username: "aether-music",
          kind: "BOT",
          allowServerDms: false,
          allowServerFriendRequests: false,
        }),
      }),
    );
    expect(appUpdate).toHaveBeenCalledWith({
      where: { id: "a" },
      data: { botUserId: "u_bot_novo" },
    });
  });
});

describe("gerarTokenDeApp", () => {
  it("bot nao habilitado -> BotNaoHabilitado", async () => {
    appFindFirst.mockResolvedValue({ id: "a", botUserId: null });
    await expect(gerarTokenDeApp("a", "u")).rejects.toBeInstanceOf(BotNaoHabilitado);
  });

  it("ok -> revoga os vivos, cria o novo, devolve o segredo", async () => {
    appFindFirst.mockResolvedValue({ id: "a", botUserId: "u_bot" });
    const r = await gerarTokenDeApp("a", "u");
    expect(r).toEqual({ token: "aeb_segredo", prefixo: "aeb_segred" });
    expect(botTokenUpdateMany).toHaveBeenCalledWith({
      where: { applicationId: "a", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(botTokenCreate).toHaveBeenCalledWith({
      data: { applicationId: "a", tokenHash: "hash_do_segredo", prefixo: "aeb_segred" },
    });
  });
});
