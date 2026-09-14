import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * Login com Google (OIDC), PKCE, sem biblioteca de terceiros.
 *
 * A ideia de partida era usar a `arctic` — mas ela foi DEPRECADA pelo proprio
 * mantenedor em jul/2026 ("nao mexo nisto ha quase um ano"), e o repo dele
 * passou a recomendar copiar o codigo do provedor em vez de instalar o
 * pacote. Isso bate direto com o que este monorepo ja faz: Spotify e Twitch
 * (`packages/access/src/spotify.ts`) e o TOTP (`@aether/shared/totp`) sao
 * tudo hand-rolled, fetch + `node:crypto`, sem lib de OAuth. Manter Google no
 * mesmo padrao evita depender de um pacote sem manutencao so pra isto.
 *
 * So o web precisa disto (cria/acha usuario, cria sessao) — o gateway
 * realtime nunca toca em login, entao — ao contrario do Spotify, que mora em
 * `@aether/access` porque o gateway TAMBEM le a atividade — este arquivo fica
 * local a `apps/web`.
 *
 * `GOOGLE_CLIENT_SECRET` so e lido aqui, um modulo `server-only` — o bundler
 * nunca inclui isto no JS mandado pro navegador.
 */

export const GOOGLE_SCOPES = "openid email profile";

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";

export class GoogleNaoConfigurado extends Error {
  constructor() {
    super("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET ausentes.");
    this.name = "GoogleNaoConfigurado";
  }
}

/** O Google recusou o `code` (expirado, reusado, redirect_uri divergente, PKCE nao bate). */
export class GoogleAutorizacaoInvalida extends Error {
  constructor(motivo: string) {
    super(`O Google recusou a troca do codigo: ${motivo}`);
    this.name = "GoogleAutorizacaoInvalida";
  }
}

/** O Google nao confirmou o dono do e-mail — nao da pra confiar nele pra login/vinculo. */
export class GoogleEmailNaoVerificado extends Error {
  constructor() {
    super("O Google nao confirma que este e-mail foi verificado.");
    this.name = "GoogleEmailNaoVerificado";
  }
}

export function googleConfigurado(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function credenciais(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new GoogleNaoConfigurado();
  return { id, secret };
}

/** 32 bytes aleatorios, base64url — usado tanto pro `state` quanto pro PKCE `code_verifier`. */
function tokenAleatorio(): string {
  return randomBytes(32).toString("base64url");
}

/** RFC 7636: `code_challenge = BASE64URL(SHA256(code_verifier))`. */
function desafioPkce(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export interface AutorizacaoGoogle {
  url: string;
  state: string;
  codeVerifier: string;
}

/**
 * Monta a URL de autorizacao (PKCE, `S256`) e devolve `state`/`codeVerifier`
 * junto — quem chama guarda os dois em cookie curto pra conferir no callback.
 */
export function criarAutorizacaoGoogle(redirectUri: string): AutorizacaoGoogle {
  const { id } = credenciais();
  const state = tokenAleatorio();
  const codeVerifier = tokenAleatorio();

  const q = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    state,
    code_challenge: desafioPkce(codeVerifier),
    code_challenge_method: "S256",
  });
  return { url: `${AUTHORIZE}?${q.toString()}`, state, codeVerifier };
}

export interface IdentidadeGoogle {
  /** `sub` do OIDC — estavel, ao contrario do e-mail (a pessoa pode trocar). */
  sub: string;
  email: string;
  nome: string | null;
  avatarUrl: string | null;
}

/** Decodifica o `payload` de um JWT (base64url), sem checar a assinatura. */
function decodificarPayloadJwt(jwt: string): Record<string, unknown> {
  const partes = jwt.split(".");
  if (partes.length !== 3) throw new Error("id_token com formato inesperado.");
  return JSON.parse(Buffer.from(partes[1]!, "base64url").toString("utf8"));
}

/**
 * Troca o `code` do callback pela identidade da pessoa.
 *
 * NAO verifica a assinatura do `id_token` — de proposito: ele veio de uma
 * chamada SERVIDOR-A-SERVIDOR pro endpoint de token do Google, autenticada
 * com nosso `client_secret` e por TLS, exatamente como a propria Arctic
 * documentava fazer (mesma razao pela qual `SpotifyAutorizacaoInvalida`
 * tambem nunca verifica assinatura nenhuma — o transporte ja e confiavel).
 * Verificar assinatura importa no fluxo IMPLICITO, onde o id_token chega
 * pelo REDIRECT do navegador e poderia ser forjado; aqui nao ha esse caminho.
 */
export async function trocarCodigoGoogle(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<IdentidadeGoogle> {
  const { id, secret } = credenciais();

  const r = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) {
    const corpo = await r.text().catch(() => "");
    throw new GoogleAutorizacaoInvalida(`HTTP ${r.status} ${corpo}`.trim());
  }

  const j = (await r.json()) as { id_token?: string };
  if (!j.id_token) throw new GoogleAutorizacaoInvalida("resposta sem id_token");

  const claims = decodificarPayloadJwt(j.id_token) as {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };

  if (!claims.email || !claims.email_verified) {
    throw new GoogleEmailNaoVerificado();
  }

  return {
    sub: claims.sub,
    email: claims.email.toLowerCase(),
    nome: claims.name ?? null,
    avatarUrl: claims.picture ?? null,
  };
}
