import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * REST v1 de bots (Etapa 6).
 *
 * Propriedades travadas:
 *  - sem token / token invalido -> 401;
 *  - bot nao instalado no servidor / canal -> 404 (nunca 403, nunca "existe mas
 *    voce nao pode");
 *  - o envio de mensagem passa pelo gateway (`/internal/send-message`), que e
 *    quem revalida a permissao e escreve;
 *  - gateway fora -> 503; recusa do gateway -> 400/404 conforme o codigo.
 */

const userFindUnique = vi.fn();
const serverFindUnique = vi.fn();
const channelFindUnique = vi.fn();
const webhookFindFirst = vi.fn();

vi.mock("@aether/db", () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    server: { findUnique: serverFindUnique },
    channel: { findUnique: channelFindUnique },
    webhook: { findFirst: webhookFindFirst },
    botToken: { updateMany: vi.fn().mockResolvedValue({}) },
  },
}));

const resolveBotToken = vi.fn();
const loadMemberAccess = vi.fn();
const getChannelPermissions = vi.fn();
const getChannelPermissionMap = vi.fn();

vi.mock("@aether/access", () => ({
  resolveBotToken,
  loadMemberAccess,
  getChannelPermissions,
  getChannelPermissionMap,
}));

const rateLimit = vi.fn().mockResolvedValue({ ok: true, retryAfter: 0 });
vi.mock("@/server/auth/rate-limit", () => ({ rateLimit }));

const enviarMensagemPeloGateway = vi.fn();
vi.mock("@/server/realtime-notify", () => ({ enviarMensagemPeloGateway }));

const listRecentMessages = vi.fn();
vi.mock("@/server/services/messages", () => ({ listRecentMessages }));

const { GET: getMe } = await import(
  "../../apps/web/src/app/api/v1/users/me/route"
);
const { GET: getServer } = await import(
  "../../apps/web/src/app/api/v1/servers/[serverId]/route"
);
const { GET: getMsgs, POST: postMsg } = await import(
  "../../apps/web/src/app/api/v1/channels/[channelId]/messages/route"
);
const { POST: postWebhook } = await import(
  "../../apps/web/src/app/api/v1/webhooks/[id]/[token]/route"
);

const BOT = { applicationId: "app_1", botUserId: "u_bot" };
const SEND = 1n << 10n;
const VIEW = 1n << 6n;

function req(opts: { auth?: string; body?: unknown } = {}) {
  return new Request("http://x/api/v1", {
    method: opts.body !== undefined ? "POST" : "GET",
    headers: opts.auth ? { authorization: opts.auth } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}
const ctx = <T>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  for (const m of [
    userFindUnique,
    serverFindUnique,
    channelFindUnique,
    webhookFindFirst,
    resolveBotToken,
    loadMemberAccess,
    getChannelPermissions,
    getChannelPermissionMap,
    enviarMensagemPeloGateway,
    listRecentMessages,
  ]) {
    m.mockReset();
  }
  rateLimit.mockReset().mockResolvedValue({ ok: true, retryAfter: 0 });
});

describe("autenticação", () => {
  it("sem Authorization -> 401", async () => {
    resolveBotToken.mockResolvedValue(null);
    const res = await getMe(req());
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it("token inválido -> 401 (e resolveBotToken foi chamado com o token puro)", async () => {
    resolveBotToken.mockResolvedValue(null);
    const res = await getMe(req({ auth: "Bearer aeb_errado" }));
    expect(res.status).toBe(401);
    expect(resolveBotToken).toHaveBeenCalledWith("aeb_errado");
  });

  it("token válido -> 200 com a identidade do bot", async () => {
    resolveBotToken.mockResolvedValue(BOT);
    userFindUnique.mockResolvedValue({
      id: "u_bot",
      username: "musica",
      displayName: "AETHER Music",
      avatarUrl: null,
    });
    const res = await getMe(req({ auth: "Bearer aeb_ok" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "u_bot",
      username: "musica",
      displayName: "AETHER Music",
      avatarUrl: null,
      kind: "BOT",
      applicationId: "app_1",
    });
  });
});

describe("GET /servers/:id", () => {
  beforeEach(() => resolveBotToken.mockResolvedValue(BOT));

  it("bot não instalado -> 404", async () => {
    loadMemberAccess.mockResolvedValue(null);
    const res = await getServer(req({ auth: "Bearer x" }), ctx({ serverId: "s_1" }));
    expect(res.status).toBe(404);
  });

  it("instalado -> 200 com {id,name,iconUrl}", async () => {
    loadMemberAccess.mockResolvedValue({ serverId: "s_1" });
    serverFindUnique.mockResolvedValue({ id: "s_1", name: "Meu Server", iconUrl: null });
    const res = await getServer(req({ auth: "Bearer x" }), ctx({ serverId: "s_1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "s_1", name: "Meu Server", iconUrl: null });
  });

  it("rate limit estourado -> 429 com Retry-After", async () => {
    loadMemberAccess.mockResolvedValue({ serverId: "s_1" });
    rateLimit.mockResolvedValue({ ok: false, retryAfter: 7 });
    const res = await getServer(req({ auth: "Bearer x" }), ctx({ serverId: "s_1" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
  });
});

describe("GET /channels/:id/messages", () => {
  beforeEach(() => resolveBotToken.mockResolvedValue(BOT));

  it("canal invisível para o bot -> 404", async () => {
    channelFindUnique.mockResolvedValue({ serverId: "s_1", type: "TEXT" });
    loadMemberAccess.mockResolvedValue({ serverId: "s_1" });
    getChannelPermissions.mockResolvedValue(0n);
    const res = await getMsgs(req({ auth: "Bearer x" }), ctx({ channelId: "c_1" }));
    expect(res.status).toBe(404);
  });

  it("visível -> 200 com { messages, hasMore }", async () => {
    channelFindUnique.mockResolvedValue({ serverId: "s_1", type: "TEXT" });
    loadMemberAccess.mockResolvedValue({ serverId: "s_1" });
    getChannelPermissions.mockResolvedValue(VIEW);
    listRecentMessages.mockResolvedValue({ messages: [{ id: "m_1" }], hasMore: false });
    const res = await getMsgs(req({ auth: "Bearer x" }), ctx({ channelId: "c_1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages: [{ id: "m_1" }], hasMore: false });
  });
});

describe("POST /channels/:id/messages", () => {
  beforeEach(() => {
    resolveBotToken.mockResolvedValue(BOT);
    channelFindUnique.mockResolvedValue({ serverId: "s_1", type: "TEXT" });
    loadMemberAccess.mockResolvedValue({ serverId: "s_1" });
    getChannelPermissions.mockResolvedValue(SEND | VIEW);
  });

  it("conteúdo vazio -> 400", async () => {
    const res = await postMsg(req({ auth: "Bearer x", body: { content: "  " } }), ctx({ channelId: "c_1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });

  it("canal inexistente -> 404 (nem chama o gateway)", async () => {
    channelFindUnique.mockResolvedValue(null);
    const res = await postMsg(req({ auth: "Bearer x", body: { content: "oi" } }), ctx({ channelId: "c_x" }));
    expect(res.status).toBe(404);
    expect(enviarMensagemPeloGateway).not.toHaveBeenCalled();
  });

  it("gateway fora do ar -> 503", async () => {
    enviarMensagemPeloGateway.mockResolvedValue(null);
    const res = await postMsg(req({ auth: "Bearer x", body: { content: "oi" } }), ctx({ channelId: "c_1" }));
    expect(res.status).toBe(503);
  });

  it("recusa do gateway 'nao_encontrada' -> 404", async () => {
    enviarMensagemPeloGateway.mockResolvedValue({
      ok: false,
      error: "Conversa nao encontrada",
      codigo: "nao_encontrada",
    });
    const res = await postMsg(req({ auth: "Bearer x", body: { content: "oi" } }), ctx({ channelId: "c_1" }));
    expect(res.status).toBe(404);
  });

  it("sucesso -> 201 com a mensagem criada", async () => {
    enviarMensagemPeloGateway.mockResolvedValue({ ok: true, message: { id: "m_9", content: "oi" } });
    const res = await postMsg(req({ auth: "Bearer x", body: { content: "oi" } }), ctx({ channelId: "c_1" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "m_9", content: "oi" });
    expect(enviarMensagemPeloGateway).toHaveBeenCalledWith({
      atorUserId: "u_bot",
      conversationId: "c_1",
      content: "oi",
      replyToId: undefined,
    });
  });
});

describe("POST /webhooks/:id/:token", () => {
  const sha256 = (s: string) =>
    require("node:crypto").createHash("sha256").update(s).digest("hex");

  it("token errado -> 404 (nem chama o gateway)", async () => {
    webhookFindFirst.mockResolvedValue(null);
    const res = await postWebhook(req({ body: { content: "oi" } }), ctx({ id: "wh_1", token: "errado" }));
    expect(res.status).toBe(404);
    expect(enviarMensagemPeloGateway).not.toHaveBeenCalled();
  });

  it("conteudo vazio -> 400", async () => {
    webhookFindFirst.mockResolvedValue({ webhookUserId: "u_wh", channelId: "c_1" });
    const res = await postWebhook(req({ body: { content: "  " } }), ctx({ id: "wh_1", token: "t" }));
    expect(res.status).toBe(400);
  });

  it("ok -> 201, publica pelo gateway com o webhookUserId e o canal fixo", async () => {
    webhookFindFirst.mockResolvedValue({ webhookUserId: "u_wh", channelId: "c_1" });
    enviarMensagemPeloGateway.mockResolvedValue({ ok: true, message: { id: "m_1" } });
    const res = await postWebhook(req({ body: { content: "Novo jogador entrou!" } }), ctx({ id: "wh_1", token: "tok" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "m_1" });
    expect(enviarMensagemPeloGateway).toHaveBeenCalledWith({
      atorUserId: "u_wh",
      conversationId: "c_1",
      content: "Novo jogador entrou!",
      origem: "webhook",
    });
    // procurou pelo HASH do token, nunca pelo token cru
    expect(webhookFindFirst.mock.calls[0]![0].where.tokenHash).toBe(sha256("tok"));
  });

  it("gateway fora -> 503", async () => {
    webhookFindFirst.mockResolvedValue({ webhookUserId: "u_wh", channelId: "c_1" });
    enviarMensagemPeloGateway.mockResolvedValue(null);
    const res = await postWebhook(req({ body: { content: "oi" } }), ctx({ id: "wh_1", token: "t" }));
    expect(res.status).toBe(503);
  });
});
