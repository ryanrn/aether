import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { criarAutorizacaoGoogle, googleConfigurado } from "@/server/auth/google";
import { clientKey, rateLimit } from "@/server/auth/rate-limit";
import { sanitizeNextPath } from "@/lib/next-path";

/**
 * Comeca o login com Google: `/api/auth/google[?next=...][&desktop=1]`.
 *
 * `state`/`codeVerifier` (PKCE) e o `next`/`desktop` da chamada vao em
 * cookies httpOnly de vida curta — e o callback quem confere tudo. `desktop`
 * so muda o formato da RESPOSTA do callback (ver `callback/route.ts`); nao
 * muda nada aqui.
 */
export const dynamic = "force-dynamic";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/api/auth/google",
  maxAge: 600,
};

export async function GET(request: Request): Promise<Response> {
  if (!googleConfigurado()) {
    return NextResponse.json(
      { error: "Login com Google nao esta configurado neste ambiente." },
      { status: 503 },
    );
  }

  // Por IP: sem isto, alguem poderia martelar o Google com URLs de
  // autorizacao (o unico custo pra nos e a chamada, mas ainda e uma chamada).
  const limite = await rateLimit(await clientKey("google-oauth"), 20, 5 * 60_000, {
    failClosed: true,
  });
  if (!limite.ok) {
    return NextResponse.json(
      { error: `Muitas tentativas. Aguarde ${limite.retryAfter}s.` },
      { status: 429 },
    );
  }

  const url = new URL(request.url);
  const next = sanitizeNextPath(url.searchParams.get("next"), "");
  const desktop = url.searchParams.get("desktop") === "1";

  const redirectUri = `${url.origin}/api/auth/google/callback`;
  const { url: authUrl, state, codeVerifier } = criarAutorizacaoGoogle(redirectUri);

  const cookieStore = await cookies();
  cookieStore.set("g_oauth_state", state, COOKIE_OPTS);
  cookieStore.set("g_oauth_verifier", codeVerifier, COOKIE_OPTS);
  cookieStore.set("g_oauth_next", next, COOKIE_OPTS);
  cookieStore.set("g_oauth_desktop", desktop ? "1" : "0", COOKIE_OPTS);

  return NextResponse.redirect(authUrl);
}
