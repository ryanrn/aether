import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@aether/access/tokens";

/**
 * Primeira barreira de acesso (Edge runtime).
 *
 * Aqui so validamos a ASSINATURA do token — o middleware nao pode falar com o
 * Postgres. A checagem de revogacao/expiracao no banco acontece em getSession(),
 * dentro de cada pagina e action. Ou seja: o middleware evita render inutil,
 * ele nao e a fonte de verdade da autorizacao.
 *
 * POR ISSO NAO HA "ja logado, pula o /login" aqui — isso um dia morou aqui e
 * causava loop de redirecionamento (ERR_TOO_MANY_REDIRECTS): um cookie com
 * assinatura valida mas REVOGADO no banco (troca de senha, "sair de tudo")
 * fazia o middleware mandar `/login` -> `/app`, e o layout de `/app` (que
 * confere o banco de verdade) mandar `/app` -> `/login` de volta, pra sempre.
 * Esse atalho agora mora em `login/page.tsx`/`register/page.tsx`, com
 * `getSession()` — o mesmo que `/app/layout.tsx` ja usava, entao os dois
 * lados sempre concordam sobre quem esta logado.
 */
const PROTECTED_PREFIXES = ["/app"];

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

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
