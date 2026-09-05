import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O adaptador da Twitch — o SEGUNDO a cumprir o contrato de provedor.
 *
 * O ponto destes testes: provar que `concluirLogin` e `renovar` generalizam do
 * Spotify sem cola. O que a Twitch faz diferente e o que precisa de trava:
 *
 *  - os segredos vao no CORPO do POST, nao em Basic auth;
 *  - a Twitch ROTA o refresh token a cada renovacao (o novo substitui o velho);
 *  - `/helix/users` exige o header `Client-Id` alem do Bearer;
 *  - 400 e 401 viram `AutorizacaoInvalida` (o registro apaga a conexao); rede
 *    caida sobe como erro comum (o registro tenta de novo).
 */

type Modulo = typeof import("../../packages/access/src/conexoes/twitch");
let twitchProvedor: Modulo["twitchProvedor"];
let AutorizacaoInvalida: typeof import("../../packages/access/src/conexoes/tipos")["AutorizacaoInvalida"];

const fetchMock = vi.fn();

beforeEach(async () => {
  process.env.TWITCH_CLIENT_ID = "cid-123";
  process.env.TWITCH_CLIENT_SECRET = "csecret-xyz";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  ({ twitchProvedor } = await import(
    "../../packages/access/src/conexoes/twitch"
  ));
  ({ AutorizacaoInvalida } = await import(
    "../../packages/access/src/conexoes/tipos"
  ));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Resposta JSON de sucesso pronta para o `fetchMock`. */
function json(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("twitchProvedor.configurado", () => {
  it("false sem os segredos", () => {
    delete process.env.TWITCH_CLIENT_ID;
    expect(twitchProvedor.configurado()).toBe(false);
  });
  it("true com os dois", () => {
    expect(twitchProvedor.configurado()).toBe(true);
  });
});

describe("twitchProvedor.urlDeLogin", () => {
  it("monta a URL de autorizacao com escopo vazio e o state", () => {
    const url = new URL(
      twitchProvedor.urlDeLogin("https://app/cb", "STATE-1"),
    );
    expect(url.origin + url.pathname).toBe(
      "https://id.twitch.tv/oauth2/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("cid-123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app/cb");
    expect(url.searchParams.get("scope")).toBe("");
    expect(url.searchParams.get("state")).toBe("STATE-1");
    expect(url.searchParams.get("response_type")).toBe("code");
  });
});

describe("twitchProvedor.concluirLogin", () => {
  it("troca o code, busca o perfil, devolve os campos do contrato", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          access_token: "acc-1",
          refresh_token: "ref-1",
          expires_in: 3600,
          scope: [],
        }),
      )
      .mockResolvedValueOnce(
        json({ data: [{ id: "42", display_name: "RyanTV", login: "ryantv" }] }),
      );

    const r = await twitchProvedor.concluirLogin(
      new URLSearchParams({ code: "the-code" }),
      "https://app/cb",
    );

    // 1a chamada: token endpoint, segredos NO CORPO
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe("https://id.twitch.tv/oauth2/token");
    const corpo = new URLSearchParams(tokenInit.body as string);
    expect(corpo.get("client_id")).toBe("cid-123");
    expect(corpo.get("client_secret")).toBe("csecret-xyz");
    expect(corpo.get("grant_type")).toBe("authorization_code");
    expect(tokenInit.headers).not.toHaveProperty("authorization");

    // 2a chamada: /helix/users com Bearer E Client-Id
    const [usersUrl, usersInit] = fetchMock.mock.calls[1]!;
    expect(usersUrl).toBe("https://api.twitch.tv/helix/users");
    expect(usersInit.headers.authorization).toBe("Bearer acc-1");
    expect(usersInit.headers["client-id"]).toBe("cid-123");

    expect(r.externalId).toBe("42");
    expect(r.displayName).toBe("RyanTV");
    expect(r.accessToken).toBe("acc-1");
    expect(r.refreshToken).toBe("ref-1");
    expect(r.expiresAt).toBeInstanceOf(Date);
  });

  it("perfil que falha nao derruba o login — so fica sem nome/id", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          access_token: "acc-2",
          refresh_token: "ref-2",
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(json({}, 500));

    const r = await twitchProvedor.concluirLogin(
      new URLSearchParams({ code: "c" }),
      "https://app/cb",
    );
    expect(r.accessToken).toBe("acc-2");
    expect(r.externalId).toBeNull();
    expect(r.displayName).toBeNull();
  });

  it("sem `code` lanca", async () => {
    await expect(
      twitchProvedor.concluirLogin(new URLSearchParams(), "https://app/cb"),
    ).rejects.toThrow(/code/);
  });

  it("token endpoint em 400 vira AutorizacaoInvalida", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "invalid" }, 400));
    await expect(
      twitchProvedor.concluirLogin(
        new URLSearchParams({ code: "c" }),
        "https://app/cb",
      ),
    ).rejects.toBeInstanceOf(AutorizacaoInvalida);
  });
});

describe("twitchProvedor.renovar", () => {
  it("rotaciona o refresh token — o novo substitui o antigo", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        access_token: "acc-novo",
        refresh_token: "ref-NOVO",
        expires_in: 7200,
        scope: [],
      }),
    );
    const t = await twitchProvedor.renovar!("ref-antigo");
    expect(t.accessToken).toBe("acc-novo");
    expect(t.refreshToken).toBe("ref-NOVO");

    const corpo = new URLSearchParams(fetchMock.mock.calls[0]![1].body as string);
    expect(corpo.get("grant_type")).toBe("refresh_token");
    expect(corpo.get("refresh_token")).toBe("ref-antigo");
  });

  it("refresh recusado (400) vira AutorizacaoInvalida", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "Invalid" }, 400));
    await expect(twitchProvedor.renovar!("morto")).rejects.toBeInstanceOf(
      AutorizacaoInvalida,
    );
  });

  it("erro de servidor (500) sobe como erro comum, NAO AutorizacaoInvalida", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await expect(twitchProvedor.renovar!("x")).rejects.not.toBeInstanceOf(
      AutorizacaoInvalida,
    );
  });
});

describe("contrato", () => {
  it("a Twitch NAO tem lerAtividade — fase 4 e cracha (igual Riot)", () => {
    expect(twitchProvedor.lerAtividade).toBeUndefined();
  });
});
