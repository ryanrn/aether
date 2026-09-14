import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { criarCodigoLoginDesktop } from "@/server/auth/desktop-handoff";

/**
 * Ultimo passo do login Google vindo do app desktop: exige uma sessao JA
 * criada (por `google/callback/route.ts`, direto ou depois do 2FA) e devolve
 * uma pagina minima que entrega um codigo de uso unico pra janela do Electron
 * via `aether://login-callback/<codigo>`.
 *
 * Existe porque o Google recusa OAuth dentro da webview do Electron — o
 * fluxo inteiro roda no navegador do sistema, e esta e a unica ponte de volta.
 * Ver o comentario de `CodigoLoginDesktop` no schema.
 */
export const dynamic = "force-dynamic";

function escapar(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(): Promise<Response> {
  const sessao = await getSession();
  if (!sessao) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/login`,
    );
  }

  const codigo = await criarCodigoLoginDesktop(sessao.user.id);
  const deepLink = `aether://login-callback/${codigo}`;

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrando no AETHER</title>
<style>
  html,body{margin:0;height:100%;background:#08090b;color:#f3f4f6;
    font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .box{height:100%;display:grid;place-items:center;padding:24px;text-align:center}
  .card{max-width:340px}
  .dot{width:44px;height:44px;border-radius:50%;background:#2f88ff;margin:0 auto 16px}
  h1{font-size:17px;margin:0 0 6px}
  p{color:#8b929c;margin:0}
  a.btn{display:inline-block;margin-top:20px;padding:8px 16px;border-radius:8px;
    border:1px solid #2a2f3a;color:#f3f4f6;text-decoration:none;font:inherit}
  a.btn:hover{background:#141824}
</style></head><body><div class="box"><div class="card">
  <div class="dot"></div>
  <h1>Entrando no AETHER…</h1>
  <p>Se a janela do app não abrir sozinha em alguns segundos, clique abaixo.</p>
  <a class="btn" id="abrir" href="${escapar(deepLink)}">Abrir o AETHER</a>
  <p style="margin-top:14px;font-size:12.5px">Pode fechar esta aba depois.</p>
</div></div>
<script>
  window.location.replace(${JSON.stringify(deepLink)});
</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
