import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  PENDENTE_2FA_COOKIE,
  PENDENTE_2FA_TTL_SECONDS,
  signPendente2faToken,
} from "@aether/access";
import {
  GoogleAutorizacaoInvalida,
  GoogleEmailNaoVerificado,
  GoogleNaoConfigurado,
  trocarCodigoGoogle,
} from "@/server/auth/google";
import { resolverUsuarioGoogle } from "@/server/services/google-auth";
import { createSession } from "@/server/auth/session";
import { sanitizeNextPath } from "@/lib/next-path";

/**
 * Volta do Google: `/api/auth/google/callback?code=...&state=...`.
 *
 * `state`/`codeVerifier` (PKCE) vem dos cookies que `route.ts` (o inicio do
 * fluxo) deixou — comparar contra o `state` da URL e o que impede CSRF: sem
 * isso, alguem poderia mandar a vitima abrir um link de callback nosso com um
 * `code` de uma sessao OAuth QUE O ATACANTE iniciou, amarrando a conta dele na
 * dela.
 *
 * Se a conta tem 2FA, NAO cria sessao aqui — cai no MESMO cookie pendente
 * (`PENDENTE_2FA_COOKIE`) que o login por senha usa, e o formulario de codigo
 * de `/login` cuida do resto. Login com Google nunca pula o segundo fator.
 */
export const dynamic = "force-dynamic";

const COOKIES = [
  "g_oauth_state",
  "g_oauth_verifier",
  "g_oauth_next",
  "g_oauth_desktop",
] as const;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const cookieStore = await cookies();

  const salvo = {
    state: cookieStore.get("g_oauth_state")?.value,
    verifier: cookieStore.get("g_oauth_verifier")?.value,
    next: cookieStore.get("g_oauth_next")?.value ?? "",
    desktop: cookieStore.get("g_oauth_desktop")?.value === "1",
  };
  // Uso unico: os cookies do fluxo somem aqui, dê certo ou não.
  for (const nome of COOKIES) cookieStore.delete(nome);

  const falhar = (motivo: string) =>
    NextResponse.redirect(
      `${url.origin}/login?erro=google&motivo=${encodeURIComponent(motivo)}`,
    );

  // A pessoa clicou em "cancelar" na tela do Google. Não é falha nossa.
  if (url.searchParams.get("error")) return falhar("cancelado");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !salvo.state || !salvo.verifier || state !== salvo.state) {
    return falhar("state_invalido");
  }

  const redirectUri = `${url.origin}/api/auth/google/callback`;

  try {
    const identidade = await trocarCodigoGoogle(code, salvo.verifier, redirectUri);
    const usuario = await resolverUsuarioGoogle(identidade);

    const destinoFinal = salvo.desktop
      ? "/api/auth/desktop-handoff"
      : sanitizeNextPath(salvo.next || null);

    if (usuario.totpHabilitadoEm !== null) {
      const token = await signPendente2faToken(usuario.id);
      cookieStore.set(PENDENTE_2FA_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: PENDENTE_2FA_TTL_SECONDS,
      });
      return NextResponse.redirect(
        `${url.origin}/login?next=${encodeURIComponent(destinoFinal)}`,
      );
    }

    await createSession(usuario.id);
    return NextResponse.redirect(`${url.origin}${destinoFinal}`);
  } catch (erro) {
    if (erro instanceof GoogleNaoConfigurado) return falhar("nao_configurado");
    if (erro instanceof GoogleAutorizacaoInvalida) return falhar("autorizacao_invalida");
    if (erro instanceof GoogleEmailNaoVerificado) return falhar("email_nao_verificado");
    throw erro;
  }
}
