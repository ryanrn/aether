import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Webhooks de entrada — camada de dados (Etapa 11).
 *
 * Trava: `criarWebhook` exige canal de TEXTO do servidor e cria a identidade
 * `User kind=WEBHOOK`; o token vai como `sha256`, nunca em claro; regenerar
 * troca o hash; revogar e soft e so pega o que e do servidor.
 */

const channelFindFirst = vi.fn();
const webhookFindMany = vi.fn();
const webhookFindFirst = vi.fn();
const webhookUpdate = vi.fn();
const webhookUpdateMany = vi.fn();
const userCreate = vi.fn();
const webhookCreate = vi.fn();

const tx = {
  user: { create: userCreate },
  webhook: { create: webhookCreate },
};

vi.mock("@aether/db", () => ({
  prisma: {
    channel: { findFirst: channelFindFirst },
    webhook: {
      findMany: webhookFindMany,
      findFirst: webhookFindFirst,
      update: webhookUpdate,
      updateMany: webhookUpdateMany,
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));

const { criarWebhook, regenerarToken, revogarWebhook, CanalInvalido } =
  await import("../../apps/web/src/server/services/webhooks");

const sha256 = (s: string) =>
  require("node:crypto").createHash("sha256").update(s).digest("hex");

beforeEach(() => {
  for (const m of [
    channelFindFirst, webhookFindMany, webhookFindFirst, webhookUpdate,
    webhookUpdateMany, userCreate, webhookCreate,
  ]) {
    m.mockReset();
  }
  userCreate.mockResolvedValue({ id: "u_wh" });
  webhookCreate.mockResolvedValue({ id: "wh_1" });
});

describe("criarWebhook", () => {
  it("canal que nao e texto/do servidor -> CanalInvalido", async () => {
    channelFindFirst.mockResolvedValue(null);
    await expect(
      criarWebhook({ serverId: "s", channelId: "c", name: "X", creatorId: "u" }),
    ).rejects.toBeInstanceOf(CanalInvalido);
  });

  it("ok -> cria User kind=WEBHOOK + Webhook com sha256 do token", async () => {
    channelFindFirst.mockResolvedValue({ id: "c_1" });
    const r = await criarWebhook({
      serverId: "s", channelId: "c_1", name: "Alertas", creatorId: "u_dono",
    });

    expect(r.id).toBe("wh_1");
    expect(r.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(r.token.length).toBeGreaterThan(20);

    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "WEBHOOK",
          displayName: "Alertas",
          allowServerDms: false,
          allowServerFriendRequests: false,
        }),
      }),
    );
    const dados = webhookCreate.mock.calls[0]![0].data;
    expect(dados.tokenHash).toBe(sha256(r.token));
    expect(dados.tokenHash).not.toBe(r.token);
    expect(dados.channelId).toBe("c_1");
    expect(dados.webhookUserId).toBe("u_wh");
  });
});

describe("regenerarToken", () => {
  it("nao e do servidor -> null", async () => {
    webhookFindFirst.mockResolvedValue(null);
    expect(await regenerarToken({ webhookId: "wh", serverId: "s" })).toBeNull();
  });
  it("ok -> troca o hash e limpa revokedAt", async () => {
    webhookFindFirst.mockResolvedValue({ id: "wh_1" });
    const r = await regenerarToken({ webhookId: "wh_1", serverId: "s" });
    const dados = webhookUpdate.mock.calls[0]![0].data;
    expect(dados.tokenHash).toBe(sha256(r!.token));
    expect(dados.revokedAt).toBeNull();
  });
});

describe("revogarWebhook", () => {
  it("count 1 -> revogado true; 0 -> false", async () => {
    webhookUpdateMany.mockResolvedValueOnce({ count: 1 });
    expect(await revogarWebhook({ webhookId: "w", serverId: "s" })).toEqual({
      revogado: true,
    });
    webhookUpdateMany.mockResolvedValueOnce({ count: 0 });
    expect(await revogarWebhook({ webhookId: "w", serverId: "s" })).toEqual({
      revogado: false,
    });
  });
});
