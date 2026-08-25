"use strict";

const { app, BrowserWindow, desktopCapturer, ipcMain, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const log = require("./log");

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

function lerPrefs() {
  try {
    return JSON.parse(fs.readFileSync(prefsFile(), "utf8"));
  } catch {
    return {};
  }
}

function gravarPrefs(prefs) {
  try {
    fs.writeFileSync(prefsFile(), JSON.stringify(prefs), "utf8");
  } catch {
    // Disco cheio ou pasta sem permissao: a escolha vale so nesta execucao.
  }
}

/**
 * O som deve vir marcado para ESTE dispositivo de saida?
 *
 * A resposta depende do dispositivo, e nao so de uma chave global — e essa foi
 * uma armadilha real da primeira versao. Antes, uma unica falha gravava
 * `withAudio: false` PARA SEMPRE. Quem consertasse a configuracao do fone, ou
 * simplesmente plugasse o cabo, continuava compartilhando mudo sem entender
 * por que, ate encontrar a caixinha escondida no seletor.
 *
 * Agora a falha e lembrada COM o dispositivo em que aconteceu. Trocou de saida
 * de audio? Merece uma tentativa nova — porque a falha era daquele aparelho,
 * nao da pessoa.
 */
/**
 * A REGRA, sem disco e sem Electron.
 *
 * Separada de proposito: era aqui que morava a armadilha da primeira versao, e
 * regra enterrada em acesso a arquivo nao se testa — testa-se o duble do
 * arquivo. Devolve tambem `prefsNovas` quando a decisao implica gravar, para
 * quem chama fazer o efeito colateral num lugar so.
 */
function decidirComPrefs(prefs, dispositivoAtual) {
  const falha = prefs?.falha ?? null;

  // Desmarcou na mao: respeitamos, sem discutir.
  if (prefs?.withAudio === false && !falha) {
    return { withAudio: false, falha: null, prefsNovas: null };
  }

  if (falha && dispositivoAtual && falha.dispositivo !== dispositivoAtual) {
    /**
     * Saida diferente da que falhou. A marca e APAGADA, nao so ignorada:
     * insistir no "nao" seria punir o aparelho novo pelo pecado do antigo.
     */
    return { withAudio: true, falha: null, prefsNovas: { withAudio: true } };
  }

  /**
   * Falha sem saber o aparelho de agora: continua valendo. Conservador de
   * proposito — sem informacao nao inventamos otimismo, porque o custo de
   * errar e a captura INTEIRA falhar, video junto.
   */
  if (falha) return { withAudio: false, falha, prefsNovas: null };

  // Padrao LIGADO: levar o som e o que a maioria espera.
  return {
    withAudio: prefs?.withAudio !== false,
    falha: null,
    prefsNovas: null,
  };
}

/** A regra acima, com o disco em volta. */
function decidirAudio(dispositivoAtual) {
  const prefs = lerPrefs();
  const decisao = decidirComPrefs(prefs, dispositivoAtual ?? null);

  if (decisao.prefsNovas) {
    gravarPrefs(decisao.prefsNovas);
    log.registrar("audio.tela.nova-tentativa", {
      falhouEm: prefs?.falha?.dispositivo ?? null,
      agora: dispositivoAtual,
    });
  }
  return { withAudio: decisao.withAudio, falha: decisao.falha };
}

function saveAudioPreference(withAudio) {
  const prefs = lerPrefs();
  // Marcar a caixa de novo apaga a falha: a pessoa esta dizendo que quer
  // tentar, e a proxima falha (se houver) grava uma marca nova.
  gravarPrefs(withAudio ? { withAudio: true } : { ...prefs, withAudio: false });
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
function disableAudioPreference(detalhes) {
  const dispositivo = detalhes?.dispositivo ?? null;
  const erro = detalhes?.erro ?? null;

  gravarPrefs({
    withAudio: false,
    falha: { dispositivo, quando: new Date().toISOString(), erro },
  });

  /**
   * O REGISTRO e metade do conserto. A versao anterior desligava o som e
   * seguia em silencio — e por isso "nao funciona" nunca virava uma causa.
   * Agora fica escrito em arquivo qual erro foi e em qual saida.
   */
  log.registrar("audio.tela.falhou", { dispositivo, erro });
}

/**
 * A ultima resposta a "levar o som do sistema", para o renderer consultar.
 *
 * Existe porque a pergunta e feita no SELETOR (processo principal) e quem
 * captura o som agora e o renderer, pelo modulo nativo. Sem este caminho de
 * volta, a caixa marcada no seletor nao chegava a lugar nenhum: o app pedia
 * som ao Chromium — que e justamente quem nao consegue — e a escolha da
 * pessoa se perdia.
 */
let ultimaEscolhaDeAudio = true;

function escolhaDeAudioDoSeletor() {
  return ultimaEscolhaDeAudio;
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

  /**
   * Janela maior desde a reformulacao: os cards passaram de 210 para 300px de
   * largura minima, e numa janela de 920 sobrava vazio em volta de duas telas.
   */
  const width = Math.min(1040, display.workArea.width - 80);
  const height = Math.min(700, display.workArea.height - 80);

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
    /**
     * O seletor manda qual e a SAIDA PADRAO de audio agora, e por isso a
     * resposta e calculada aqui e nao lida de uma chave fixa: uma falha
     * anterior so continua valendo se for no MESMO aparelho.
     *
     * O `motivo` volta junto para a janela poder explicar por que a caixa
     * esta desmarcada, em vez de a pessoa achar que desmarcou sem querer.
     */
    ipcMain.handle("picker:sources", (_evento, dispositivoAtual) => {
      const decisao = decidirAudio(dispositivoAtual ?? null);
      return {
        sources: payload,
        withAudio: decisao.withAudio,
        motivo: decisao.falha,
      };
    });

    ipcMain.on("picker:choose", (_event, choice) => {
      const source = sources.find((item) => item.id === choice?.id);
      if (!source) {
        finish(null);
        return;
      }
      const withAudio = choice.withAudio === true;
      ultimaEscolhaDeAudio = withAudio;
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

/**
 * `decidirAudio` e `saveAudioPreference` sao exportados para os testes: e neles
 * que mora a regra de "a falha vale so naquele aparelho", que ja foi errada uma
 * vez e deixou gente muda para sempre.
 */
module.exports = {
  pickSource,
  escolhaDeAudioDoSeletor,
  disableAudioPreference,
  /** exportada para teste: e a regra que ja errou uma vez */
  decidirComPrefs,
};
