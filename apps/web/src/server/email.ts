import "server-only";

/**
 * Envio de e-mail, via API REST do Resend.
 *
 * Sem SDK de proposito: e uma chamada HTTP com um JSON, e `storage.ts` ja fala
 * com o Supabase pelo mesmo caminho. Uma dependencia a menos para atualizar,
 * auditar e carregar no bundle.
 *
 * A chave e do SERVIDOR e nunca desce para o cliente. Este arquivo tem
 * `server-only` no topo justamente para o build quebrar se alguem importar
 * daqui de um componente de cliente.
 */

const ENDPOINT = "https://api.resend.com/emails";

export interface EnvioResultado {
  ok: boolean;
  /** motivo tecnico, para o LOG — nunca para a tela do usuario */
  motivo?: string;
}

/**
 * Manda um e-mail. Devolve `ok: false` em vez de lancar.
 *
 * Quem chama decide o que dizer para o usuario, e no caso da redefinicao de
 * senha a resposta e a MESMA de qualquer jeito — contar que o envio falhou
 * revelaria que aquela conta existe.
 */
export async function enviarEmail({
  para,
  assunto,
  html,
  texto,
}: {
  para: string;
  assunto: string;
  html: string;
  texto: string;
}): Promise<EnvioResultado> {
  const chave = process.env.RESEND_API_KEY;
  const remetente = process.env.EMAIL_FROM;

  if (!chave || !remetente) {
    /**
     * Sem configuracao NAO fingimos que enviou. Em desenvolvimento isso e o
     * normal, e o chamador imprime o link no console para dar para testar o
     * fluxo inteiro sem provedor nenhum.
     */
    return { ok: false, motivo: "RESEND_API_KEY ou EMAIL_FROM ausente" };
  }

  try {
    const resposta = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${chave}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: remetente,
        to: [para],
        subject: assunto,
        html,
        // Versao em texto junto: cliente que nao renderiza HTML, e leitor de
        // tela, recebem algo legivel em vez de marcacao crua.
        text: texto,
      }),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => "");
      return { ok: false, motivo: `HTTP ${resposta.status}: ${corpo.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (erro) {
    return {
      ok: false,
      motivo: erro instanceof Error ? erro.message : "falha de rede",
    };
  }
}

/** O e-mail de redefinicao, em HTML e em texto. */
export function emailDeRedefinicao(link: string, nome: string) {
  const texto = [
    `Ola, ${nome}.`,
    "",
    "Alguem pediu para redefinir a senha da sua conta no AETHER.",
    "Se foi voce, abra o endereco abaixo. Ele vale por 1 hora e so pode ser",
    "usado uma vez:",
    "",
    link,
    "",
    "Se nao foi voce, ignore este e-mail — sua senha continua a mesma e",
    "ninguem consegue entrar so por ter pedido isto.",
  ].join("\n");

  const html = `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0B0D10;padding:32px;color:#C5CAD3">
  <div style="max-width:480px;margin:0 auto;background:#111318;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:28px">
    <p style="margin:0 0 6px;font-size:12px;letter-spacing:.22em;color:#6A6F79">AETHER</p>
    <h1 style="margin:0 0 18px;font-size:18px;color:#F0F1F5">Redefinir sua senha</h1>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
      Ola, <strong style="color:#F0F1F5">${escaparHtml(nome)}</strong>. Alguem pediu para
      redefinir a senha da sua conta.
    </p>
    <p style="margin:0 0 22px;font-size:14px;line-height:1.6">
      Se foi voce, use o botao abaixo. Ele vale por <strong>1 hora</strong> e so
      funciona <strong>uma vez</strong>.
    </p>
    <a href="${link}" style="display:inline-block;background:#3B82A0;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:8px">
      Redefinir senha
    </a>
    <p style="margin:22px 0 0;font-size:12.5px;line-height:1.6;color:#6A6F79">
      Se nao foi voce, ignore este e-mail. Sua senha continua a mesma, e ninguem
      consegue entrar so por ter pedido isto.
    </p>
  </div>
</div>`.trim();

  return { html, texto };
}

/**
 * O nome vem do banco, mas foi escolhido pelo usuario — e vai para dentro de
 * HTML que outra pessoa le. Escapar aqui e o que impede alguem se cadastrar
 * como `<script>` e mandar isso na caixa de entrada alheia.
 */
function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
