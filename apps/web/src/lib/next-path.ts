/**
 * Higieniza um destino pos-login vindo da URL (`?next=`).
 *
 * O `next` chega do NAVEGADOR — de um link de convite, de um redirect do
 * middleware, de qualquer lugar. Sem filtro, viraria "open redirect": um
 * `?next=https://site-falso/` levaria a pessoa para fora logo depois de ela
 * digitar a senha, e um `?next=//evil.com` faria o mesmo (o navegador trata
 * `//host` como URL absoluta).
 *
 * A regra e estreita de proposito: so caminho interno, so as areas que fazem
 * sentido como destino de convite/login. Qualquer outra coisa cai no padrao.
 *
 * Sem dependencias: roda tambem no middleware (Edge).
 */

/** Prefixos que um `next` pode apontar. O resto e ignorado. */
const PERMITIDOS = ["/app", "/invite/"];

export function sanitizeNextPath(
  raw: string | null | undefined,
  fallback = "/app",
): string {
  if (!raw) return fallback;

  // Precisa ser caminho relativo a raiz. `//` e `/\` sao absolutos disfarcados.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return fallback;
  }

  // Sem esquema embutido (`/x:evil` ou controles).
  if (/[\x00-\x1f]/.test(raw) || raw.includes("\\")) return fallback;

  // So o pathname decide; querystring/hash proprios do destino podem ficar.
  const semQuery = raw.split(/[?#]/, 1)[0]!;

  const ok =
    semQuery === "/app" ||
    PERMITIDOS.some(
      (p) => semQuery === p || semQuery.startsWith(p.endsWith("/") ? p : `${p}/`),
    );

  return ok ? raw : fallback;
}
