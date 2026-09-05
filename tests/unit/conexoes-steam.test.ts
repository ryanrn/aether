import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O adaptador da Steam — o que QUEBRA a suposicao de OAuth.
 *
 * Sem `code`, sem `client_secret` na autenticacao, sem token, sem refresh. Se
 * `concluirLogin` devolvendo tudo `null` menos o `externalId` funciona, o
 * contrato aguenta qualquer provedor.
 *
 * O teste crucial e a VERIFICACAO: a resposta do OpenID e so um monte de
 * parametro na URL, trivial de forjar. A unica prova de que veio da Steam e o
 * `check_authentication` responder `is_valid:true`. Um adaptador que pula essa
 * chamada deixa qualquer um se passar por qualquer SteamID.
 */

type Modulo = typeof import("../../packages/access/src/conexoes/steam");
let steamProvedor: Modulo["steamProvedor"];
let AutorizacaoInvalida: typeof import("../../packages/access/src/conexoes/tipos")["AutorizacaoInvalida"];

const fetchMock = vi.fn();
const STEAMID = "76561198000000001";
const CLAIMED = `https://steamcommunity.com/openid/id/${STEAMID}`;

/** Os parametros que a Steam devolve num login de verdade (id_res). */
function respostaOpenId(over: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": "https://steamcommunity.com/openid/login",
    "openid.claimed_id": CLAIMED,
    "openid.identity": CLAIMED,
    "openid.return_to": "https://app/api/conexoes/steam/callback?state=S",
    "openid.response_nonce": "2026-09-05T00:00:00Zabc",
    "openid.assoc_handle": "handle-1",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to",
    "openid.sig": "ZmFrZXNpZw==",
    state: "S",
    ...over,
  });
}

function textResp(body: string, ok = true) {
  return { ok, status: ok ? 200 : 500, text: async () => body };
}
function jsonResp(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(async () => {
  process.env.STEAM_WEB_API_KEY = "key-abc";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  ({ steamProvedor } = await import(
    "../../packages/access/src/conexoes/steam"
  ));
  ({ AutorizacaoInvalida } = await import(
    "../../packages/access/src/conexoes/tipos"
  ));
});
afterEach(() => vi.unstubAllGlobals());

describe("steamProvedor.configurado", () => {
  it("segue a STEAM_WEB_API_KEY", () => {
    expect(steamProvedor.configurado()).toBe(true);
    delete process.env.STEAM_WEB_API_KEY;
    expect(steamProvedor.configurado()).toBe(false);
  });
});

describe("steamProvedor.urlDeLogin", () => {
  it("monta o checkid_setup com identifier_select e o realm da origem", () => {
    const url = new URL(
      steamProvedor.urlDeLogin(
        "https://app/api/conexoes/steam/callback",
        "STATE-1",
      ),
    );
    expect(url.origin + url.pathname).toBe(
      "https://steamcommunity.com/openid/login",
    );
    expect(url.searchParams.get("openid.mode")).toBe("checkid_setup");
    expect(url.searchParams.get("openid.realm")).toBe("https://app");
    expect(url.searchParams.get("openid.identity")).toBe(
      "http://specs.openid.net/auth/2.0/identifier_select",
    );
    // o state viaja no return_to
    const retorno = new URL(url.searchParams.get("openid.return_to")!);
    expect(retorno.searchParams.get("state")).toBe("STATE-1");
  });
});

describe("steamProvedor.concluirLogin", () => {
  it("verifica com a Steam, extrai o SteamID, busca o nome — tokens nulos", async () => {
    fetchMock
      .mockResolvedValueOnce(textResp("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n"))
      .mockResolvedValueOnce(
        jsonResp({ response: { players: [{ personaname: "RyanPlays" }] } }),
      );

    const r = await steamProvedor.concluirLogin(
      respostaOpenId(),
      "https://app/api/conexoes/steam/callback",
    );

    // 1a chamada: check_authentication de volta para a Steam
    const [verifUrl, verifInit] = fetchMock.mock.calls[0]!;
    expect(verifUrl).toBe("https://steamcommunity.com/openid/login");
    const corpo = new URLSearchParams(verifInit.body as URLSearchParams);
    expect(corpo.get("openid.mode")).toBe("check_authentication");
    expect(corpo.get("openid.claimed_id")).toBe(CLAIMED);

    expect(r.externalId).toBe(STEAMID);
    expect(r.displayName).toBe("RyanPlays");
    expect(r.accessToken).toBeNull();
    expect(r.refreshToken).toBeNull();
    expect(r.expiresAt).toBeNull();
  });

  it("is_valid:false vira AutorizacaoInvalida — NAO guarda a conexao", async () => {
    fetchMock.mockResolvedValueOnce(textResp("is_valid:false\n"));
    await expect(
      steamProvedor.concluirLogin(
        respostaOpenId(),
        "https://app/api/conexoes/steam/callback",
      ),
    ).rejects.toBeInstanceOf(AutorizacaoInvalida);
  });

  it("mode que nao e id_res nao chega nem a verificar", async () => {
    await expect(
      steamProvedor.concluirLogin(
        respostaOpenId({ "openid.mode": "cancel" }),
        "https://app/api/conexoes/steam/callback",
      ),
    ).rejects.toBeInstanceOf(AutorizacaoInvalida);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("claimed_id que nao e uma URL de SteamID valida e recusado", async () => {
    fetchMock.mockResolvedValueOnce(textResp("is_valid:true\n"));
    await expect(
      steamProvedor.concluirLogin(
        respostaOpenId({
          "openid.claimed_id": "https://steamcommunity.com/openid/id/evil",
        }),
        "https://app/api/conexoes/steam/callback",
      ),
    ).rejects.toBeInstanceOf(AutorizacaoInvalida);
  });

  it("nome do perfil que falha nao derruba o login", async () => {
    fetchMock
      .mockResolvedValueOnce(textResp("is_valid:true\n"))
      .mockResolvedValueOnce(textResp("boom", false));
    const r = await steamProvedor.concluirLogin(
      respostaOpenId(),
      "https://app/api/conexoes/steam/callback",
    );
    expect(r.externalId).toBe(STEAMID);
    expect(r.displayName).toBeNull();
  });
});

describe("contrato", () => {
  it("Steam NAO tem renovar (OpenID nao da refresh)", () => {
    expect(steamProvedor.renovar).toBeUndefined();
  });
  it("Steam NAO tem lerAtividade — fase 5 e cracha", () => {
    expect(steamProvedor.lerAtividade).toBeUndefined();
  });
});
