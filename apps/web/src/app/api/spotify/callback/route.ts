import {
  buscarPerfil,
  guardarConta,
  trocarCodigo,
  verificarState,
} from "@aether/access";
import { getSession } from "@/server/auth/session";

/**
 * Volta da autorizacao do Spotify: troca o `code` pelos tokens, cifra e guarda.
 *
 * NAO redireciona para o app. O fluxo abre numa janela/aba separada (no
 * desktop, no navegador do sistema), entao redirecionar para `/app` abriria o
 * site do Aether onde nao devia. Em vez disso responde uma pagina minima que
 * tenta se fechar sozinha (`window.close()` funciona quando a janela foi
 * aberta por `window.open`) e, se nao der, diz para a pessoa voltar ao app.
 *
 * A seccao das configuracoes re-checa o estado quando o app recupera o foco.
 */
export const dynamic = "force-dynamic";

function pagina(titulo: string, detalhe: string, sucesso: boolean): Response {
  const cor = sucesso ? "#1DB954" : "#e5484d";
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo} · Aether</title>
<style>
  html,body{margin:0;height:100%;background:#0d0f13;color:#e8eaed;
    font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .box{height:100%;display:grid;place-items:center;padding:24px;text-align:center}
  .card{max-width:340px}
  .dot{width:44px;height:44px;border-radius:50%;background:${cor};margin:0 auto 16px}
  h1{font-size:17px;margin:0 0 6px}
  p{color:#9aa0a6;margin:0}
  button{margin-top:20px;padding:8px 16px;border-radius:8px;border:1px solid #2a2f3a;
    background:transparent;color:#e8eaed;font:inherit;cursor:pointer}
  button:hover{background:#1a1e26}
</style></head><body><div class="box"><div class="card">
  <div class="dot"></div>
  <h1>${titulo}</h1>
  <p>${detalhe}</p>
  <button id="acao">${sucesso ? "Voltar ao Aether" : "Fechar"}</button>
</div></div>
<script>
  var abertoPorPopup = !!window.opener && window.opener !== window;
  function voltar(){
    if (abertoPorPopup) { try{ window.close() }catch(e){} }
    else { window.location.replace("/app${sucesso ? "?spotify=ok" : "?spotify=erro"}"); }
  }
  document.getElementById("acao").addEventListener("click", voltar);
  setTimeout(voltar, ${sucesso ? 900 : 3500});
</script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const sessao = await getSession();
  if (!sessao) {
    return pagina(
      "Sessao expirada",
      "Entre no Aether de novo e tente conectar o Spotify.",
      false,
    );
  }

  if (url.searchParams.get("error")) {
    return pagina(
      "Autorizacao cancelada",
      "Voce pode fechar esta janela e voltar ao Aether.",
      false,
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return pagina("Algo deu errado", "Tente conectar o Spotify de novo.", false);
  }

  const dono = await verificarState(state);
  if (dono !== sessao.user.id) {
    return pagina(
      "Nao consegui confirmar",
      "Comece o fluxo de novo pela tela de configuracoes.",
      false,
    );
  }

  try {
    const redirectUri = `${url.origin}/api/spotify/callback`;
    const tokens = await trocarCodigo(code, redirectUri);
    const { displayName } = await buscarPerfil(tokens.accessToken).catch(() => ({
      displayName: null,
    }));
    await guardarConta({
      userId: sessao.user.id,
      tokens,
      spotifyName: displayName,
    });
    return pagina(
      "Spotify conectado",
      "Pode fechar esta janela e voltar ao Aether.",
      true,
    );
  } catch {
    return pagina(
      "Nao consegui conectar",
      "Tente de novo pela tela de configuracoes.",
      false,
    );
  }
}
