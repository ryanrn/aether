import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE, signSessionToken } from "@aether/access";
import { middleware } from "../../apps/web/src/middleware";

/**
 * CSP com nonce na area logada (auditoria M1).
 *
 * A politica global (`next.config.ts`) carrega `script-src 'unsafe-inline'`
 * porque o App Router injeta script inline de hidratacao. O middleware fecha
 * essa brecha SO em `/app/*` — que ja e 100% dinamica — adicionando um segundo
 * cabecalho de CSP com nonce + strict-dynamic. `/login`, `/register` e o
 * marketing seguem so com a politica global e continuam estaticos.
 *
 * Sem banco: o middleware so confere a ASSINATURA do token.
 */

function pedido(path: string): NextRequest {
  return new NextRequest(`https://aether.app${path}`);
}

async function comCookieDeSessao(path: string): Promise<NextRequest> {
  const token = await signSessionToken({ sid: "sessao-1", sub: "usuario-1" });
  return new NextRequest(`https://aether.app${path}`, {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
}

describe("middleware — CSP com nonce em /app/*", () => {
  it("injeta script-src com nonce e strict-dynamic, sem unsafe-inline", async () => {
    const res = await middleware(await comCookieDeSessao("/app/s/abc"));
    const csp = res.headers.get("content-security-policy");

    expect(csp).toBeTruthy();
    expect(csp).toContain("script-src");
    expect(csp).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("'wasm-unsafe-eval'");
    // A brecha que este item existe para fechar.
    expect(csp).not.toContain("'unsafe-inline'");
  });

  it("repassa o nonce para o Next via header de requisicao", async () => {
    const res = await middleware(await comCookieDeSessao("/app"));

    const nonceNoHeader = res.headers.get("x-middleware-request-x-nonce");
    expect(nonceNoHeader).toBeTruthy();

    const csp = res.headers.get("content-security-policy") ?? "";
    // o mesmo nonce que foi para a politica
    expect(csp).toContain(`'nonce-${nonceNoHeader}'`);
  });

  it("gera um nonce diferente a cada requisicao", async () => {
    const a = await middleware(await comCookieDeSessao("/app"));
    const b = await middleware(await comCookieDeSessao("/app"));
    expect(a.headers.get("x-middleware-request-x-nonce")).not.toBe(
      b.headers.get("x-middleware-request-x-nonce"),
    );
  });

  it("nao adiciona CSP em /login (fica com a politica global)", async () => {
    const res = await middleware(pedido("/login"));
    const csp = res.headers.get("content-security-policy");
    expect(csp).toBeNull();
  });

  it("/app sem sessao redireciona para /login, sem CSP de nonce", async () => {
    const res = await middleware(pedido("/app/s/abc"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.headers.get("content-security-policy")).toBeNull();
  });
});
