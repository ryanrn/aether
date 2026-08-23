"use strict";

const { app, dialog } = require("electron");
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

function instalarAtualizador() {
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

  autoUpdater.on("update-downloaded", async (info) => {
    console.log("[updater] baixada:", info?.version);

    const { response } = await dialog.showMessageBox({
      type: "info",
      buttons: ["Reiniciar agora", "Depois"],
      defaultId: 0,
      cancelId: 1,
      title: "Atualizacao pronta",
      message: `A versao ${info?.version ?? "nova"} do AETHER esta pronta.`,
      detail:
        "Ela sera aplicada quando voce reiniciar o app. Se estiver numa call, " +
        "pode deixar para depois — a atualizacao fica guardada e entra sozinha " +
        "no proximo fechamento.",
    });

    if (response === 0) {
      // `isSilent: false` mostra o instalador; `isForceRunAfter: true` reabre.
      autoUpdater.quitAndInstall(false, true);
    }
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
