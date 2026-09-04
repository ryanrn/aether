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
    /**
     * A SELECAO ANTERIOR PRECISA SAIR DO CAMINHO.
     *
     * `execCommand("copy")` copia o que estiver selecionado no documento. Se o
     * `select()` abaixo nao pegar (elemento sem foco, por exemplo), ele copia a
     * selecao que ja existia na pagina — e o que vai para a area de
     * transferencia e um pedaco de HTML renderizado, que cola como um bloco
     * formatado em vez do texto. Foi exatamente esse o sintoma relatado
     * ("copiou um print").
     */
    const selecao = window.getSelection();
    selecao?.removeAllRanges();

    const area = document.createElement("textarea");
    area.value = texto;
    // `readonly` evita o teclado virtual no celular; fora da tela evita o
    // salto de rolagem que um `focus()` num elemento visivel causaria.
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    // `focus()` ANTES do `select()`: sem foco no elemento, a selecao nao vale.
    area.focus();
    area.select();
    area.setSelectionRange(0, texto.length);

    // Se a selecao nao pegou, copiar agora pegaria a coisa errada — melhor
    // falhar e dizer isso do que colocar lixo na area de transferencia.
    const pegou = area.selectionEnd - area.selectionStart === texto.length;
    const ok = pegou ? document.execCommand("copy") : false;

    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
