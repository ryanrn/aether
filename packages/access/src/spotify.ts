import { SignJWT, jwtVerify } from "jose";
import { safeMusicActivity, type MusicActivity } from "@aether/shared";

/**
 * Integracao com o Spotify — o que o app web (OAuth) e o gateway (poller)
 * precisam falar com a API.
 *
 * Mora em `@aether/access` pela mesma razao da sessao e do ticket: os DOIS
 * lados precisam, e a regra de "uma copia so" vale para integracao externa
 * tambem. O `client_secret` sai de env (`SPOTIFY_CLIENT_SECRET`) e nunca vai
 * para bundle nenhum — mesma regra do `TWITCH_CLIENT_SECRET` do IGDB.
 *
 * Escopo minimo: so `user-read-currently-playing`. Nao pedimos controle de
 * playback nem historico — so "o que toca agora".
 */

export const SPOTIFY_SCOPE = "user-read-currently-playing";

const AUTHORIZE = "https://accounts.spotify.com/authorize";
const TOKEN = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

export class SpotifyNaoConfigurado extends Error {
  constructor() {
    super("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET ausentes.");
    this.name = "SpotifyNaoConfigurado";
  }
}

/** Marca um token que a Spotify recusou — quem chama derruba a conta ligada. */
export class SpotifyAutorizacaoInvalida extends Error {
  constructor() {
    super("O Spotify recusou o token (401).");
    this.name = "SpotifyAutorizacaoInvalida";
  }
}

export function spotifyConfigurado(): boolean {
  return Boolean(
    process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET,
  );
}

// --- `state` do OAuth: anti-CSRF, amarrado ao usuario -----------------------

const STATE_AUDIENCE = "aether-spotify-state";

function chaveState(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET ausente/curto.");
  return new TextEncoder().encode(secret);
}

/** JWT curto (10 min) que so serve para o callback conferir de quem e o code. */
export async function assinarState(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer("aether")
    .setAudience(STATE_AUDIENCE)
    .setExpirationTime("600s")
    .sign(chaveState());
}

export async function verificarState(state: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(state, chaveState(), {
      issuer: "aether",
      audience: STATE_AUDIENCE,
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function credenciais(): { id: string; secret: string } {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new SpotifyNaoConfigurado();
  return { id, secret };
}

function basic(): string {
  const { id, secret } = credenciais();
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

/** URL para onde o navegador vai pedir autorizacao. `state` e o anti-CSRF. */
export function urlDeAutorizacao(redirectUri: string, state: string): string {
  const { id } = credenciais();
  const q = new URLSearchParams({
    response_type: "code",
    client_id: id,
    scope: SPOTIFY_SCOPE,
    redirect_uri: redirectUri,
    state,
    show_dialog: "false",
  });
  return `${AUTHORIZE}?${q.toString()}`;
}

export interface TokensSpotify {
  accessToken: string;
  refreshToken: string;
  /** epoch ms de quando o access token expira */
  expiresAt: number;
  scope: string;
}

/** Troca o `code` do callback pelos tokens. */
export async function trocarCodigo(
  code: string,
  redirectUri: string,
): Promise<TokensSpotify> {
  const r = await fetch(TOKEN, {
    method: "POST",
    headers: {
      authorization: basic(),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`troca de codigo falhou: HTTP ${r.status}`);
  const j = (await r.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Date.now() + j.expires_in * 1000,
    scope: j.scope,
  };
}

/**
 * Renova o access token. O Spotify NEM SEMPRE devolve um refresh token novo —
 * quando nao devolve, o antigo continua valendo.
 */
export async function renovarToken(
  refreshToken: string,
): Promise<Omit<TokensSpotify, "refreshToken"> & { refreshToken: string | null }> {
  const r = await fetch(TOKEN, {
    method: "POST",
    headers: {
      authorization: basic(),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (r.status === 400 || r.status === 401) throw new SpotifyAutorizacaoInvalida();
  if (!r.ok) throw new Error(`renovacao falhou: HTTP ${r.status}`);
  const j = (await r.json()) as {
    access_token: string;
    expires_in: number;
    scope: string;
    refresh_token?: string;
  };
  return {
    accessToken: j.access_token,
    expiresAt: Date.now() + j.expires_in * 1000,
    scope: j.scope,
    refreshToken: j.refresh_token ?? null,
  };
}

/** Quem e a pessoa na Spotify: nome para a tela, e o id para a conexao. */
export async function buscarPerfil(
  accessToken: string,
): Promise<{ displayName: string | null; id: string | null }> {
  const r = await fetch(`${API}/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (r.status === 401) throw new SpotifyAutorizacaoInvalida();
  if (!r.ok) return { displayName: null, id: null };
  // O `id` alimenta o `externalId` da conexao — e o que impede duas contas do
  // Aether reivindicarem o mesmo perfil do Spotify.
  const j = (await r.json()) as { display_name?: string; id?: string };
  return { displayName: j.display_name ?? null, id: j.id ?? null };
}

/**
 * O que toca agora, ja no formato da presenca. `null` = nada tocando (ou
 * anuncio/podcast, que ignoramos). Lanca `SpotifyAutorizacaoInvalida` no 401.
 */
export async function buscarTocandoAgora(
  accessToken: string,
): Promise<MusicActivity | null> {
  const r = await fetch(`${API}/me/player/currently-playing`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (r.status === 401) throw new SpotifyAutorizacaoInvalida();
  // 204 = nada tocando; 200 com is_playing false tambem conta como parado.
  if (r.status === 204 || !r.ok) return null;

  const j = (await r.json()) as {
    is_playing?: boolean;
    currently_playing_type?: string;
    item?: {
      name?: string;
      artists?: { name?: string }[];
      album?: { images?: { url?: string }[] };
      external_urls?: { spotify?: string };
    } | null;
  };

  if (!j.is_playing || j.currently_playing_type !== "track" || !j.item) {
    return null;
  }

  const art =
    j.item.album?.images?.find((i) => typeof i.url === "string")?.url ?? null;

  return safeMusicActivity({
    title: j.item.name,
    artists: (j.item.artists ?? [])
      .map((a) => a.name)
      .filter(Boolean)
      .join(", "),
    art,
    url: j.item.external_urls?.spotify,
  });
}
