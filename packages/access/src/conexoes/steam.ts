import {
  AutorizacaoInvalida,
  type Provedor,
  type ResultadoDoLogin,
} from "./tipos";

/**
 * A Steam como PROVEDOR — o adaptador que QUEBRA a suposicao de OAuth.
 *
 * A Steam nao usa OAuth. Usa OpenID 2.0: nao ha `client_secret` na
 * autenticacao, nao ha `code` para trocar, nao ha token de usuario, nao ha
 * refresh. O que volta do login e so a identidade — um SteamID64.
 *
 * Se o contrato de `Provedor` aguenta ISSO — `concluirLogin` devolvendo tudo
 * `null` menos o `externalId`, `renovar` e `lerAtividade` ambos ausentes — ele
 * aguenta qualquer coisa. Foi por isso que a Steam veio antes da Riot.
 *
 * FASE 5 = CRACHA. Mostrar "jogando X" precisa do tipo de atividade novo, do
 * poller observando SteamIDs, e depende do perfil da pessoa estar publico —
 * fica para uma fase propria.
 *
 * `STEAM_WEB_API_KEY` (https://steamcommunity.com/dev/apikey) e o opt-in: a
 * autenticacao OpenID em si nao precisa dele, mas GetPlayerSummaries (o nome
 * de exibicao) precisa, e a futura atividade tambem. Sem a chave, a Steam
 * aparece em "ainda nao disponivel". So no servidor, nunca em bundle.
 */

const LOGIN = "https://steamcommunity.com/openid/login";
const API_RESUMO =
  "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/";
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

function chaveWebApi(): string {
  const k = process.env.STEAM_WEB_API_KEY;
  if (!k) throw new Error("STEAM_WEB_API_KEY ausente.");
  return k;
}

export const steamProvedor: Provedor = {
  id: "STEAM",
  nome: "Steam",

  configurado() {
    return Boolean(process.env.STEAM_WEB_API_KEY);
  },

  /**
   * OpenID `checkid_setup`. `identifier_select` = "voce descobre quem e".
   *
   * `realm` PRECISA cobrir o `return_to`: a Steam recusa se o `return_to` nao
   * estiver sob o `realm`. Ambos saem da mesma origem, entao batem.
   */
  urlDeLogin(redirectUri, state) {
    const origem = new URL(redirectUri).origin;
    // O `state` viaja na propria URL de retorno — OpenID nao tem campo `state`,
    // mas nada impede um parametro nosso no `return_to`. O registro le e
    // confere igual faz com os outros provedores.
    const retorno = new URL(redirectUri);
    retorno.searchParams.set("state", state);

    const q = new URLSearchParams({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      "openid.return_to": retorno.toString(),
      "openid.realm": origem,
      "openid.identity":
        "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id":
        "http://specs.openid.net/auth/2.0/identifier_select",
    });
    return `${LOGIN}?${q.toString()}`;
  },

  async concluirLogin(parametros): Promise<ResultadoDoLogin> {
    /**
     * VERIFICACAO — a parte critica.
     *
     * Sem isto, qualquer um forja `openid.claimed_id=.../id/<steamid da
     * vitima>` e se passa por ela. A unica prova de que a resposta veio mesmo
     * da Steam e devolver os parametros para ela com `mode=check_authentication`
     * e receber `is_valid:true`.
     */
    if (parametros.get("openid.mode") !== "id_res") {
      throw new AutorizacaoInvalida("STEAM");
    }

    const verificacao = new URLSearchParams(parametros);
    verificacao.set("openid.mode", "check_authentication");

    const r = await fetch(LOGIN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: verificacao,
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`Steam check_authentication: HTTP ${r.status}`);
    const texto = await r.text();
    if (!/is_valid\s*:\s*true/.test(texto)) {
      throw new AutorizacaoInvalida("STEAM");
    }

    const claimed = parametros.get("openid.claimed_id") ?? "";
    const m = CLAIMED_ID.exec(claimed);
    if (!m) throw new AutorizacaoInvalida("STEAM");
    const steamId = m[1]!;

    // Nome de exibicao — melhor-esforco. Sem ele a conexao ainda vale, so fica
    // como "Conta Steam" na tela.
    const displayName = await nomeDoPerfil(steamId).catch(() => null);

    return {
      externalId: steamId,
      displayName,
      // OpenID nao entrega token de usuario. TODOS nulos, de proposito.
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      scope: null,
    };
  },
};

async function nomeDoPerfil(steamId: string): Promise<string | null> {
  const url = new URL(API_RESUMO);
  url.searchParams.set("key", chaveWebApi());
  url.searchParams.set("steamids", steamId);
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return null;
  const j = (await r.json()) as {
    response?: { players?: { personaname?: string }[] };
  };
  return j.response?.players?.[0]?.personaname ?? null;
}
