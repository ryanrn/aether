"use strict";

const { app, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const log = require("./log");

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

/**
 * O que esta acontecendo, para a tela poder dizer.
 *
 * `ocioso` | `verificando` | `baixando` | `pronta` | `atualizado` | `erro`
 *
 * Existe porque o download acontecia em SILENCIO TOTAL: 82 MB baixando sem
 * nenhum indicio na tela. Fechar o app no meio — coisa normal de fazer, ja
 * que nada indicava que havia algo em curso — descartava tudo e recomecava do
 * zero na proxima abertura. Foi exatamente o que aconteceu na 0.1.9: o
 * `pending` do updater ficava com carimbo de hora recente e vazio.
 */
let estado = { fase: "ocioso", versao: null, progresso: 0, erro: null };

function mudarEstado(janela, novo) {
  estado = { ...estado, ...novo };
  if (janela && !janela.isDestroyed()) {
    janela.webContents.send("desktop:atualizacao-estado", estado);
  }
}

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

  /**
   * O DIAGNOSTICO VAI PARA O ARQUIVO, e nao para `console`.
   *
   * Em app empacotado nao ha terminal: tudo que o updater dizia por
   * `console.log` simplesmente sumia. Quando a atualizacao nao chegou na
   * 0.1.9, nao havia UMA linha para consultar — deu para descobrir o que
   * houve so olhando o carimbo de hora de uma pasta de cache. Log de
   * atualizacao e exatamente o tipo de coisa que so se procura quando algo
   * deu errado, e ai ja e tarde para instrumentar.
   */
  autoUpdater.on("error", (erro) => {
    /**
     * Falhar em atualizar NAO pode atrapalhar quem so quer conversar. Sem
     * rede, sem release publicada ainda, GitHub fora do ar — tudo isso vira
     * uma linha de log e nada mais.
     */
    const mensagem = erro?.message ?? String(erro);
    log.registrar("updater.erro", { erro: mensagem });
    mudarEstado(janela, { fase: "erro", erro: mensagem });
  });

  autoUpdater.on("checking-for-update", () => {
    log.registrar("updater.verificando", {});
    mudarEstado(janela, { fase: "verificando", erro: null });
  });

  autoUpdater.on("update-available", (info) => {
    log.registrar("updater.encontrou", { versao: info?.version });
    mudarEstado(janela, {
      fase: "baixando",
      versao: info?.version ?? null,
      progresso: 0,
    });
  });

  autoUpdater.on("update-not-available", () => {
    log.registrar("updater.ja-atualizado", { versao: app.getVersion() });
    mudarEstado(janela, { fase: "atualizado", progresso: 0 });
  });

  /**
   * Progresso. Sem isto a pessoa nao tem como saber que vale a pena deixar o
   * app aberto mais um minuto — que e a diferenca entre a atualizacao chegar
   * e nao chegar.
   */
  autoUpdater.on("download-progress", (p) => {
    mudarEstado(janela, { fase: "baixando", progresso: Math.round(p?.percent ?? 0) });
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
    log.registrar("updater.baixada", { versao: versaoPronta });
    mudarEstado(janela, { fase: "pronta", versao: versaoPronta, progresso: 100 });
    avisarPagina(janela, versaoPronta);
  });

  /** A pagina perguntando ao carregar — ver o comentario de `versaoPronta`. */
  ipcMain.handle("desktop:atualizacao-pendente", () => versaoPronta);

  /** O estado inteiro, para a tela de configuracoes desenhar o que houver. */
  ipcMain.handle("desktop:atualizacao-estado", () => ({
    ...estado,
    versaoAtual: app.getVersion(),
  }));

  /**
   * Verificar AGORA, a pedido da pessoa.
   *
   * Existe porque a verificacao automatica e invisivel: ela roda 8s depois de
   * abrir e depois de 6 em 6 horas, sem dizer nada. Quando nao funciona — e
   * nao funcionou — nao ha como distinguir "ja estou atualizado" de "nem
   * tentou". Um botao que responde na hora resolve as duas coisas: da controle
   * e da diagnostico.
   */
  ipcMain.handle("desktop:atualizacao-verificar", async () => {
    if (versaoPronta) {
      // Ja tem uma esperando: nao adianta procurar de novo.
      mudarEstado(janela, { fase: "pronta", versao: versaoPronta, progresso: 100 });
      return { ...estado, versaoAtual: app.getVersion() };
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (erro) {
      const mensagem = erro?.message ?? String(erro);
      log.registrar("updater.verificar.falhou", { erro: mensagem });
      mudarEstado(janela, { fase: "erro", erro: mensagem });
    }
    return { ...estado, versaoAtual: app.getVersion() };
  });

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
      log.registrar("updater.checagem.falhou", { erro: erro?.message ?? String(erro) });
    });
  }

  log.registrar("updater.instalado", { versao: app.getVersion() });

  setTimeout(verificar, ATRASO_MS);
  setInterval(verificar, INTERVALO_MS);
}

module.exports = { instalarAtualizador };
