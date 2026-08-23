"use strict";

const { app, BrowserWindow, desktopCapturer, ipcMain, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Seletor proprio de tela/janela.
 *
 * Por que existe: a versao anterior pegava `sources[0]` e ja compartilhava —
 * sem perguntar nada. A aposta era que `useSystemPicker: true` faria o Windows
 * abrir o seletor nativo antes de chegar no nosso codigo, mas nesta combinacao
 * de Electron e Windows isso nao acontece, e o "plano B" virou o comportamento
 * de sempre. O sintoma: clicar em compartilhar ia direto para a tela inteira.
 *
 * O caminho que o Discord usa e este: chamar `desktopCapturer.getSources()`,
 * desenhar as miniaturas numa grade propria, e so capturar depois da escolha.
 * Da controle e fica com a cara do app, em vez da caixa do sistema.
 */

/** Miniatura grande o suficiente para reconhecer a janela, pequena para ser rapida. */
const THUMBNAIL = { width: 400, height: 240 };

/**
 * Preferencias do seletor, guardadas entre execucoes.
 *
 * Existe por causa de UMA coisa: quando o sistema recusa abrir a captura de
 * som, pedir audio faz a captura INTEIRA falhar — video junto. Sem lembrar a
 * escolha, a pessoa desmarcaria a caixa toda vez que fosse compartilhar.
 *
 * Quando isso acontece: o loopback le da saida PADRAO do Windows, e alguns
 * dispositivos nao abrem em modo captura. Verificado com um fone Logitech
 * PRO X2 — funciona no cabo P2, falha no receptor USB sem fio, com o mesmo
 * `Could not start audio source` do navegador. No onboard funciona.
 *
 * Quem desliga isto nao e so o clique da pessoa: o renderer avisa a falha por
 * `desktop:audio-capture-failed`, e ai a proxima tentativa ja sai sem som em
 * vez de repetir o mesmo erro para sempre.
 */
function prefsFile() {
  return path.join(app.getPath("userData"), "picker-prefs.json");
}

function readAudioPreference() {
  try {
    const raw = fs.readFileSync(prefsFile(), "utf8");
    const parsed = JSON.parse(raw);
    // Padrao LIGADO: levar o som e o que a maioria espera.
    return parsed.withAudio !== false;
  } catch {
    return true;
  }
}

function saveAudioPreference(withAudio) {
  try {
    fs.writeFileSync(prefsFile(), JSON.stringify({ withAudio }), "utf8");
  } catch {
    // Disco cheio ou pasta sem permissao: a escolha vale so nesta execucao.
  }
}

/**
 * Chamada quando o RENDERER avisa que a captura de som falhou de verdade
 * (getDisplayMedia rejeitou com erro de audio).
 *
 * Sem isto, a preferencia so mudava quando a PESSOA desmarcava a caixa no
 * seletor — e no main.js pedimos audio sempre (`isDesktopApp() ? true : ...`),
 * entao numa maquina onde o loopback falha (verificado: dongles sem fio),
 * cada tentativa reabria o mesmo erro para sempre. Desligar aqui e o que faz
 * a proxima tentativa sair sem som e funcionar de primeira.
 */
function disableAudioPreference() {
  saveAudioPreference(false);
}

let pickerWindow = null;

/**
 * Abre o seletor e resolve com a escolha.
 *
 * `null` significa CANCELOU — e cancelar nao e erro, e escolha. Quem chama
 * devolve `{}` para o Electron, que traduz isso num `NotAllowedError`, o mesmo
 * que o navegador faz quando alguem fecha o seletor nativo.
 */
async function pickSource(parentWindow) {
  // Uma janela por vez: clicar duas vezes rapido nao pode abrir duas.
  if (pickerWindow && !pickerWindow.isDestroyed()) {
    pickerWindow.focus();
    return null;
  }

  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: THUMBNAIL,
    fetchWindowIcons: true,
  });

  if (sources.length === 0) return null;

  /**
   * As miniaturas viram data URL aqui, no processo principal. O renderer NAO
   * recebe acesso ao desktopCapturer — se recebesse, a janela do seletor
   * poderia enumerar telas por conta propria, e nao ha motivo para isso.
   */
  const payload = sources.map((source) => ({
    id: source.id,
    name: source.name,
    isScreen: source.id.startsWith("screen:"),
    thumbnail: source.thumbnail.isEmpty()
      ? null
      : source.thumbnail.toDataURL(),
    appIcon: source.appIcon && !source.appIcon.isEmpty()
      ? source.appIcon.toDataURL()
      : null,
  }));

  const bounds = parentWindow?.getBounds();
  const display = screen.getDisplayNearestPoint(
    bounds
      ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      : screen.getPrimaryDisplay().bounds,
  );

  const width = Math.min(920, display.workArea.width - 80);
  const height = Math.min(640, display.workArea.height - 80);

  pickerWindow = new BrowserWindow({
    width,
    height,
    parent: parentWindow ?? undefined,
    modal: Boolean(parentWindow),
    show: false,
    frame: false,
    resizable: false,
    backgroundColor: "#0a0b0f",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "picker", "preload.js"),
    },
  });

  return new Promise((resolve) => {
    let settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      ipcMain.removeHandler("picker:sources");
      ipcMain.removeAllListeners("picker:choose");
      ipcMain.removeAllListeners("picker:cancel");
      const window = pickerWindow;
      pickerWindow = null;
      if (window && !window.isDestroyed()) window.close();
      resolve(result);
    }

    /**
     * Os handlers sao registrados ANTES do loadFile, e a ordem nao e estilo.
     * O renderer pede as fontes assim que carrega; com o registro depois, esse
     * pedido chegava antes do handler existir, a chamada rejeitava e a grade
     * ficava vazia — janela bonita e sem nada dentro.
     */
    ipcMain.handle("picker:sources", () => ({
      sources: payload,
      withAudio: readAudioPreference(),
    }));

    ipcMain.on("picker:choose", (_event, choice) => {
      const source = sources.find((item) => item.id === choice?.id);
      if (!source) {
        finish(null);
        return;
      }
      const withAudio = choice.withAudio === true;
      saveAudioPreference(withAudio);
      finish({ source, withAudio });
    });

    ipcMain.on("picker:cancel", () => finish(null));

    // Fechar pelo Esc ou pelo X e cancelar, nao travar a promessa.
    pickerWindow.on("closed", () => finish(null));
    pickerWindow.once("ready-to-show", () => pickerWindow?.show());

    void pickerWindow.loadFile(path.join(__dirname, "picker", "index.html"));
  });
}

module.exports = { pickSource, disableAudioPreference };
