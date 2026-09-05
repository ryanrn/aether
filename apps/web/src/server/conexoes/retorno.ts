import type { ConnectionProvider } from "@aether/db";
import {
  concluirLogin,
  ProvedorNaoConfigurado,
  StateInvalido,
} from "@aether/access";
import { getSession } from "@/server/auth/session";

/**
 * A volta de um login de conexao — a parte que vale para TODO provedor.
 *
 * Extraido da rota do Spotify quando ela deixou de ser a unica. O que era
 * especifico (trocar o `code`, ler o perfil) desceu para o adaptador do
 * provedor; o que era comum (sessao, `state`, pagina de retorno) subiu para
 * ca. Somar Twitch, Steam ou Riot nao cria arquivo de rota nenhum.
 *
 * NAO REDIRECIONA PARA O APP. O fluxo abre numa janela separada (no desktop,
 * no navegador do sistema), entao redirecionar para `/app` abriria o site do
 * Aether onde nao devia. Em vez disso responde uma pagina minima que tenta se
 * fechar sozinha (`window.close()` so funciona se a janela foi aberta por
 * `window.open`) e, se nao der, volta para o app.
 */

/** Escapa o que vai para dentro do HTML. Nada aqui vem de fora, mas custa nada. */
function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function paginaDeRetorno(params: {
  titulo: string;
  detalhe: string;
  sucesso: boolean;
  /** ex.: `spotify=ok` — o app le isso para abrir a aba certa */
  query: string;
}): Response {
  const cor = params.sucesso ? "#1DB954" : "#e5484d";
  const titulo = escapar(params.titulo);
  const detalhe = escapar(params.detalhe);
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
  <button id="acao">${params.sucesso ? "Voltar ao Aether" : "Fechar"}</button>
</div></div>
<script>
  var abertoPorPopup = !!window.opener && window.opener !== window;
  function voltar(){
    if (abertoPorPopup) { try{ window.close() }catch(e){} }
    else { window.location.replace("/app?${params.query}"); }
  }
  document.getElementById("acao").addEventListener("click", voltar);
  setTimeout(voltar, ${params.sucesso ? 900 : 3500});
</script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * Trata a volta do provedor, do comeco ao fim.
 *
 * `chaveDeRetorno` e o que vai na URL do app (`?spotify=ok`). O Spotify
 * mantem a dele porque a `control-bar` ja a le; provedores novos usam o
 * proprio nome.
 */
export async function tratarCallbackDeConexao(
  request: Request,
  provider: ConnectionProvider,
  chaveDeRetorno: string,
): Promise<Response> {
  const url = new URL(request.url);
  const ok = `${chaveDeRetorno}=ok`;
  const erro = `${chaveDeRetorno}=erro`;

  const sessao = await getSession();
  if (!sessao) {
    return paginaDeRetorno({
      titulo: "Sessao expirada",
      detalhe: "Entre no Aether de novo e tente conectar.",
      sucesso: false,
      query: erro,
    });
  }

  // A pessoa clicou em "cancelar" na tela do provedor. Nao e falha nossa.
  if (url.searchParams.get("error")) {
    return paginaDeRetorno({
      titulo: "Autorizacao cancelada",
      detalhe: "Voce pode fechar esta janela e voltar ao Aether.",
      sucesso: false,
      query: erro,
    });
  }

  try {
    await concluirLogin({
      sessionUserId: sessao.user.id,
      provider,
      parametros: url.searchParams,
      // Precisa ser IGUAL ao usado ao pedir autorizacao, senao o provedor
      // recusa a troca do `code`.
      redirectUri: `${url.origin}${url.pathname}`,
    });
    return paginaDeRetorno({
      titulo: "Conta conectada",
      detalhe: "Pode fechar esta janela e voltar ao Aether.",
      sucesso: true,
      query: ok,
    });
  } catch (e) {
    /**
     * `state` invalido ganha texto proprio: e o unico caso em que "tente de
     * novo" nao adianta se a pessoa nao recomecar PELA TELA DE CONFIGURACOES
     * — um link de callback guardado ou vindo de fora nunca vai passar.
     */
    if (e instanceof StateInvalido) {
      return paginaDeRetorno({
        titulo: "Nao consegui confirmar",
        detalhe: "Comece o fluxo de novo pela tela de configuracoes.",
        sucesso: false,
        query: erro,
      });
    }
    if (e instanceof ProvedorNaoConfigurado) {
      return paginaDeRetorno({
        titulo: "Integracao indisponivel",
        detalhe: "Este servico nao esta configurado neste ambiente.",
        sucesso: false,
        query: erro,
      });
    }
    return paginaDeRetorno({
      titulo: "Algo deu errado",
      detalhe: "Tente conectar de novo.",
      sucesso: false,
      query: erro,
    });
  }
}
