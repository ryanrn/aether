import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@aether/access/tokens";
import { sanitizeNextPath } from "@/lib/next-path";

/**
 * Primeira barreira de acesso (Edge runtime).
 *
 * Aqui so validamos a ASSINATURA do token — o middleware nao pode falar com o
 * Postgres. A checagem de revogacao/expiracao no banco acontece em getSession(),
 * dentro de cada pagina e action. Ou seja: o middleware evita render inutil,
 * ele nao e a fonte de verdade da autorizacao.
 */
const PROTECTED_PREFIXES = ["/app"];
const AUTH_ROUTES = ["/login", "/register"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySessionToken(token) : null;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !claims) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (claims && AUTH_ROUTES.includes(pathname)) {
    // Ja logado numa tela de login/cadastro: pula direto para o destino. Sem
    // isto, um `/login?next=/invite/xxx` clicado por quem ja tem sessao caia
    // em `/app` e o convite se perdia.
    const destino = sanitizeNextPath(request.nextUrl.searchParams.get("next"));
    const url = request.nextUrl.clone();
    const [caminho, query] = destino.split("?", 2);
    url.pathname = caminho!;
    url.search = query ? `?${query}` : "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/login", "/register"],
};
