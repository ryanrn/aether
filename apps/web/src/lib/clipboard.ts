"use client";

/**
 * Copiar para a area de transferencia, com plano B.
 *
 * POR QUE EXISTE: `navigator.clipboard.writeText` e a API certa, mas ela FALHA
 * CALADA em situacoes reais deste app:
 *
 *  - no aplicativo de desktop (Electron), onde a permissao de escrita nem
 *    sempre esta concedida e a promessa e rejeitada sem erro visivel;
 *  - quando a janela nao esta em foco (a promessa rejeita com NotAllowedError);
 *  - em contexto nao seguro (http), onde `navigator.clipboard` nem existe.
 *
 * Nos cinco lugares que copiavam algo, o `catch` era vazio ou inexistente: o
 * botao piscava "Copiado" (ou nem isso) e a area de transferencia continuava
 * com o conteudo antigo. Copiar que mente e pior do que copiar que falha.
 *
 * O plano B e o `textarea` + `execCommand("copy")`. Esta depreciado, sim, e
 * continua sendo o unico caminho que funciona sem permissao no Electron. Ele
 * so roda quando o caminho moderno falhou.
 *
 * Devolve `false` quando os dois falharam — quem chama precisa DIZER isso na
 * tela, nao fingir que deu certo.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // Cai no plano B.
  }

  try {
    const area = document.createElement("textarea");
    area.value = texto;
    // `readonly` evita o teclado virtual no celular; fora da tela evita o
    // salto de rolagem que um `focus()` num elemento visivel causaria.
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, texto.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
