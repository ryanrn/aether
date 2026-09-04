import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@aether/access/tokens";

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

/**
 * CSP com nonce para a area logada (auditoria M1).
 *
 * A politica global vem do `next.config.ts` e carrega `script-src
 * 'unsafe-inline'` — concessao necessaria porque o App Router injeta script
 * inline de hidratacao em toda pagina, e tirar isso exige nonce por
 * requisicao, que so o middleware pode gerar.
 *
 * Em vez de reescrever a politica inteira aqui (o middleware roda no Edge e
 * NAO enxerga `SUPABASE_URL` / `R2_*`, que nao sao `NEXT_PUBLIC` — nao daria
 * para reproduzir `connect-src`/`img-src`), adicionamos um SEGUNDO cabecalho
 * de CSP so com `script-src`. O navegador aplica os dois: um script precisa
 * passar em AMBOS. A politica global segue mandando em tudo que nao e script;
 * esta aperta o script para exigir nonce.
 *
 * `'strict-dynamic'`: o nonce so vai nos scripts que o Next injeta; os chunks
 * que eles carregam depois herdam a confianca por propagacao, sem precisar de
 * allowlist de host. `'unsafe-inline'` (na politica global) passa a ser
 * ignorado pelo navegador para script assim que ha nonce — que e o objetivo.
 *
 * So na area `/app/*`, que ja e 100% renderizada sob demanda (sessao/cookie):
 * o nonce nao custa render estatico nenhum aqui. `/login`, `/register` e o
 * marketing seguem com a politica global e continuam estaticos.
 */
const emDev = process.env.NODE_ENV !== "production";

function scriptCspComNonce(nonce: string): string {
  return [
    "script-src",
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "'wasm-unsafe-eval'",
    // Fast Refresh do Next avalia codigo em tempo de execucao — dev apenas.
    emDev ? "'unsafe-eval'" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function gerarNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

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
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!isProtected) return NextResponse.next();

  /**
   * Area logada: injeta o nonce.
   *
   * O Next le o nonce do cabecalho `Content-Security-Policy` da REQUISICAO
   * (nao da resposta) e o aplica nos `<script>` que renderiza. Por isso o
   * cabecalho vai nos dois lugares: no request para o Next enxergar, e no
   * response (via `append`, ao lado da politica global) para o navegador
   * exigir.
   */
  const nonce = gerarNonce();
  const scriptCsp = scriptCspComNonce(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", scriptCsp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.append("Content-Security-Policy", scriptCsp);
  return response;
}

export const config = {
  matcher: ["/app/:path*", "/login", "/register"],
};
