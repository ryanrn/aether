"use strict";

const { app, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");

/**
 * Atualizacao automatica da CASCA.
 *
 * Nao confundir com o conteudo: o site vem da rede e ja se atualiza sozinho a
 * cada deploy. Isto aqui e para quando o codigo do PROPRIO Electron muda —
 * seletor de tela, deteccao de jogo, captura de audio. Antes disso, cada
 * mudanca dessas exigia reenviar 78MB e pedir para todo mundo reinstalar.
 *
 * As versoes vem de um repositorio PUBLICO separado (`aether-releases`),
 * enquanto o codigo fica privado: release de repo privado exige token para
 * baixar, e token embutido num programa distribuido e token publicado.
 *
 * O download e automatico; a INSTALACAO nao. Reiniciar o app no meio de uma
 * call para aplicar update seria pior que o problema que estamos resolvendo.
 */

/** Espera antes de checar. A abertura do app ja tem trabalho suficiente. */
const ATRASO_MS = 8_000;
/** E depois, de tempos em tempos, para quem deixa o app dias aberto. */
const INTERVALO_MS = 6 * 60 * 60 * 1000;

/**
 * A versao ja baixada e esperando reinicio, ou `null`.
 *
 * Guardada porque a PAGINA pode carregar depois do download: o evento
 * `update-downloaded` acontece uma vez, e quem chegar atrasado precisa de
 * alguem a quem perguntar. Sem isto, atualizar durante o boot faria o botao
 * so aparecer na proxima vez que o app abrisse — que e justamente quando ele
 * ja nao seria mais necessario.
 */
let versaoPronta = null;

/** Avisa a pagina, se ela ja existir. */
function avisarPagina(janela, versao) {
  if (janela && !janela.isDestroyed()) {
    janela.webContents.send("desktop:atualizacao-pronta", versao);
  }
}

function instalarAtualizador(janela) {
  /**
   * Em desenvolvimento nao ha versao publicada com que comparar, e o
   * electron-updater reclama alto. Sair cedo mantem o log de dev legivel.
   */
  if (!app.isPackaged) {
    console.log("[updater] app nao empacotado: verificacao desligada");
    return;
  }

  // Baixa sozinho, mas NAO instala sozinho: quem escolhe a hora e a pessoa.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (erro) => {
    /**
     * Falhar em atualizar NAO pode atrapalhar quem so quer conversar. Sem
     * rede, sem release publicada ainda, GitHub fora do ar — tudo isso vira
     * uma linha de log e nada mais.
     */
    console.error("[updater] falhou:", erro?.message ?? erro);
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[updater] versao nova encontrada:", info?.version);
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] ja esta na versao mais recente");
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("[updater] baixada:", info?.version);

    /**
     * O AVISO E DENTRO DO APP, e nao mais uma caixa nativa do Windows.
     *
     * Antes isto abria um `dialog.showMessageBox`: fonte do sistema, titulo
     * do processo, botoes fora do desenho do app — e, pior, roubando o foco
     * de quem podia estar no meio de uma call. Agora vira um botao verde na
     * barra de titulo, que a pessoa clica quando quiser.
     *
     * `autoInstallOnAppQuit` continua ligado, entao ignorar o botao nao custa
     * nada: a atualizacao entra sozinha no proximo fechamento.
     */
    versaoPronta = info?.version ?? "nova";
    avisarPagina(janela, versaoPronta);
  });

  /** A pagina perguntando ao carregar — ver o comentario de `versaoPronta`. */
  ipcMain.handle("desktop:atualizacao-pendente", () => versaoPronta);

  ipcMain.handle("desktop:atualizacao-instalar", () => {
    if (!versaoPronta) return false;
    /**
     * `setImmediate` para o `invoke` conseguir responder antes de o app
     * comecar a fechar: sem isso, a promessa do lado da pagina fica pendurada
     * e o clique parece nao ter feito nada nos milissegundos ate a janela sumir.
     */
    setImmediate(() => {
      // `isSilent: false` mostra o instalador; `isForceRunAfter: true` reabre.
      autoUpdater.quitAndInstall(false, true);
    });
    return true;
  });

  function verificar() {
    autoUpdater.checkForUpdates().catch((erro) => {
      console.error("[updater] checagem falhou:", erro?.message ?? erro);
    });
  }

  setTimeout(verificar, ATRASO_MS);
  setInterval(verificar, INTERVALO_MS);
}

module.exports = { instalarAtualizador };
