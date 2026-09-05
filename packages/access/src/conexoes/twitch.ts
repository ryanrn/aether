import {
  AutorizacaoInvalida,
  type Provedor,
  type ResultadoDoLogin,
  type TokensRenovados,
} from "./tipos";

/**
 * A Twitch como PROVEDOR — o segundo adaptador, escrito para PROVAR o contrato.
 *
 * O ponto de fazer a Twitch antes de Steam e Riot: ela tem o mesmo formato do
 * Spotify (OAuth 2.0 com code + refresh), entao se `concluirLogin` e `renovar`
 * generalizam, generalizam aqui de graca. Steam (OpenID, sem token) e Riot (so
 * identidade) e que vao testar os limites.
 *
 * FASE 4 = CRACHA. `lerAtividade` esta AUSENTE de proposito: mostrar "ao vivo
 * agora" exige um tipo de atividade novo (`AtividadeExterna` so tem `musica`),
 * o poller observando usuarios da Twitch, e uma decisao de como o cartao de
 * perfil desenha isso. Fica para depois. Por ora a conexao mostra o nome na
 * Twitch, e nada mais — igual ao que a Riot vai ser.
 *
 * `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` sao os MESMOS que o gateway ja
 * usa para o IGDB (metadados de jogo). Uma app da Twitch serve os dois fluxos;
 * o que muda e que agora ela precisa ter o `redirect_uri` da conexao
 * cadastrado, e as vars precisam existir TAMBEM no web (a troca do code roda
 * la). O `client_secret` nunca vai para bundle nenhum.
 */

const AUTHORIZE = "https://id.twitch.tv/oauth2/authorize";
const TOKEN = "https://id.twitch.tv/oauth2/token";
const USERS = "https://api.twitch.tv/helix/users";

function credenciais(): { id: string; secret: string } {
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET ausentes.");
  }
  return { id, secret };
}

/** Traduz o 401/400 da Twitch para o erro do contrato. */
function seRecusou(status: number): void {
  if (status === 400 || status === 401) {
    throw new AutorizacaoInvalida("TWITCH");
  }
}

async function trocarNoEndpoint(
  corpo: Record<string, string>,
): Promise<{
  access: string;
  refresh: string | null;
  expiraEmMs: number;
  scope: string | null;
}> {
  const { id, secret } = credenciais();
  const r = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      ...corpo,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  seRecusou(r.status);
  if (!r.ok) throw new Error(`Twitch token: HTTP ${r.status}`);
  const j = (await r.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string[];
  };
  return {
    access: j.access_token,
    // A Twitch ROTA o refresh token a cada renovacao — o novo substitui o
    // antigo. Quando nao vem (troca inicial sempre traz), mantem o que tinha.
    refresh: j.refresh_token ?? null,
    expiraEmMs: Date.now() + j.expires_in * 1000,
    scope: j.scope?.join(" ") ?? null,
  };
}

export const twitchProvedor: Provedor = {
  id: "TWITCH",
  nome: "Twitch",

  configurado() {
    return Boolean(
      process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET,
    );
  },

  urlDeLogin(redirectUri, state) {
    const { id } = credenciais();
    const q = new URLSearchParams({
      response_type: "code",
      client_id: id,
      redirect_uri: redirectUri,
      // Sem escopo: `/helix/users` devolve id, login e display_name so com um
      // token valido. Nao pedimos e-mail nem nada alem da identidade.
      scope: "",
      state,
    });
    return `${AUTHORIZE}?${q.toString()}`;
  },

  async concluirLogin(parametros, redirectUri): Promise<ResultadoDoLogin> {
    const code = parametros.get("code");
    if (!code) throw new Error("Twitch nao devolveu `code`.");

    const t = await trocarNoEndpoint({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });

    const perfil = await buscarPerfil(t.access).catch(() => ({
      id: null,
      displayName: null,
    }));

    return {
      externalId: perfil.id,
      displayName: perfil.displayName,
      accessToken: t.access,
      refreshToken: t.refresh,
      expiresAt: new Date(t.expiraEmMs),
      scope: t.scope,
    };
  },

  async renovar(refreshToken): Promise<TokensRenovados> {
    const t = await trocarNoEndpoint({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    return {
      accessToken: t.access,
      refreshToken: t.refresh,
      expiresAt: new Date(t.expiraEmMs),
      scope: t.scope,
    };
  },
};

/** Quem e a pessoa na Twitch: id para a conexao, display_name para a tela. */
async function buscarPerfil(
  accessToken: string,
): Promise<{ id: string | null; displayName: string | null }> {
  const { id } = credenciais();
  const r = await fetch(USERS, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "client-id": id,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (r.status === 401) throw new AutorizacaoInvalida("TWITCH");
  if (!r.ok) return { id: null, displayName: null };
  const j = (await r.json()) as {
    data?: { id?: string; display_name?: string; login?: string }[];
  };
  const u = j.data?.[0];
  return {
    id: u?.id ?? null,
    displayName: u?.display_name ?? u?.login ?? null,
  };
}
