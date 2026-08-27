"use strict";

const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pickSource, disableAudioPreference } = require("./picker");
const { instalarLoopback, encerrarLoopback } = require("./loopback-ipc");
const { criarVigia } = require("./game-detect");
const { instalarAtualizador } = require("./updater");

/**
 * Casca desktop do Aether.
 *
 * Ela NAO empacota o site: carrega o app que ja esta publicado. O Next roda no
 * servidor (Server Actions, SSR), entao nao existe versao estatica para
 * embutir — e mesmo que existisse, embutir significaria reinstalar a cada
 * correcao. Assim uma correcao publicada chega sem ninguem baixar nada.
 *
 * O que o desktop acrescenta, e que o navegador nao da:
 *  - captura de audio do sistema por LOOPBACK, um caminho de codigo diferente
 *    do getDisplayMedia do navegador (que falha em algumas maquinas Windows);
 *  - janela propria, com icone e atalho.
 */

/** Origem oficial. Tudo fora daqui abre no navegador do sistema, nunca aqui. */
const APP_ORIGIN = process.env.AETHER_APP_URL ?? "https://aether-mocha-phi.vercel.app";

function isAllowedUrl(rawUrl) {
  try {
    const target = new URL(rawUrl);
    const allowed = new URL(APP_ORIGIN);
    return target.origin === allowed.origin;
  } catch {
    return false;
  }
}

/**
 * Entrega a fonte de captura de tela, depois de PERGUNTAR qual.
 *
 * A versao anterior pegava `sources[0]` e ja compartilhava. A aposta era que
 * `useSystemPicker: true` faria o Windows abrir o seletor nativo antes de
 * chegar aqui — nesta combinacao de Electron e Windows isso nao acontece, e o
 * "plano B" virou o comportamento de sempre. O sintoma era compartilhar a tela
 * inteira direto, sem perguntar nada.
 *
 * Agora abrimos um seletor proprio, com miniaturas — o mesmo caminho que o
 * Discord usa. Sem `useSystemPicker`: com ele ligado o Electron poderia
 * resolver a escolha sozinho e nunca chamar este handler.
 *
 * O `loopbackWithSilence` e o motivo principal de existir a versao desktop.
 * No navegador, pedir audio junto e tudo-ou-nada: se o sistema recusa abrir o
 * som, a captura inteira falha. Aqui a captura passa por implementacao propria
 * do Electron, que e outro caminho de codigo.
 */
function installDisplayMediaHandler(targetSession) {
  targetSession.setDisplayMediaRequestHandler((request, callback) => {
    /**
     * `audioRequested` diz o que o RENDERER pediu — que nao e a mesma coisa
     * que a chave do nosso seletor.
     *
     * Sao duas decisoes: o app web chama getDisplayMedia com a caixinha dele,
     * e o seletor tem a propria. Se elas divergirem e o Chromium ignorar o
     * audio que devolvemos, a chave do seletor viraria enfeite. Logar isto e
     * o que torna essa divergencia visivel em vez de silenciosa.
     *
     * Visivel so em `npm run dev:desktop`: no app instalado nao ha console
     * ligado, a menos que se rode o .exe por um terminal.
     */
    console.log("[display-media] pedido do renderer:", {
      audioRequested: request.audioRequested,
      videoRequested: request.videoRequested,
      securityOrigin: request.securityOrigin,
    });

    /**
     * A janela principal, para o seletor abrir como modal em cima dela.
     *
     * NAO derivamos de `request.frame`: aquilo e um WebFrameMain, e
     * `BrowserWindow.fromWebContents` espera um WebContents — passar o tipo
     * errado LANCA, o handler morre antes de abrir qualquer coisa, e o
     * getDisplayMedia fica sem resposta. Foi exatamente esse o sintoma:
     * clicar em compartilhar e nao acontecer nada.
     *
     * Como este app tem uma janela principal so, pegar a primeira e correto e
     * nao tem como dar errado.
     */
    const parent =
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;

    void pickSource(parent)
      .then((choice) => {
        // Cancelar nao e erro: `{}` vira NotAllowedError no cliente, o mesmo
        // que o navegador devolve quando alguem fecha o seletor nativo.
        if (!choice) {
          callback({});
          return;
        }
        /**
         * A chave `audio` e OMITIDA quando nao ha som, em vez de ir como
         * `undefined`: o Electron valida o campo e recusa undefined com
         * "audio must be a WebFrameMain, loopback or loopbackWithMute" — e
         * ai a captura inteira morre, inclusive o video.
         *
         * O valor e `loopback`, o unico aceito no Windows para som do
         * sistema. (`loopbackWithSilence` nao existe; foi um chute meu que
         * o proprio Electron recusou.)
         */
        const response = { video: choice.source };
        if (choice.withAudio && process.platform === "win32") {
          response.audio = "loopback";
        }
        callback(response);
      })
      .catch((error) => {
        console.error("[picker] falhou:", error);
        callback({});
      });
  });
}

/* -------------------------------------------------------------------------
 * Deteccao de jogo
 *
 * Comeca DESLIGADA e so liga quando a pessoa pede nas configuracoes. Ler a
 * lista de programas abertos de alguem nao e coisa que se faz por padrao.
 *
 * O casamento acontece todo aqui, no processo principal: a pagina recebe
 * apenas o NOME do jogo ja identificado, nunca a lista de processos.
 * ------------------------------------------------------------------------- */

function prefsDeJogo() {
  return path.join(app.getPath("userData"), "game-prefs.json");
}

function lerDeteccaoLigada() {
  try {
    const bruto = fs.readFileSync(prefsDeJogo(), "utf8");
    // Padrao DESLIGADO: so vale como ligada se estiver escrito que sim.
    return JSON.parse(bruto).enabled === true;
  } catch {
    return false;
  }
}

function salvarDeteccaoLigada(enabled) {
  try {
    fs.writeFileSync(prefsDeJogo(), JSON.stringify({ enabled }), "utf8");
  } catch {
    // Disco cheio ou pasta sem permissao: a escolha vale so nesta execucao.
  }
}

let vigiaDeJogo = null;

function instalarDeteccaoDeJogo() {
  vigiaDeJogo = criarVigia((jogo) => {
    for (const janela of BrowserWindow.getAllWindows()) {
      if (!janela.isDestroyed()) {
        janela.webContents.send("desktop:game-changed", jogo);
      }
    }
  });

  ipcMain.handle("desktop:game-detection-get", () => lerDeteccaoLigada());

  // O que ja foi detectado, para a pagina que acabou de carregar nao ficar
  // esperando a proxima MUDANCA de jogo para saber do jogo que ja esta aberto.
  ipcMain.handle("desktop:game-current", () =>
    lerDeteccaoLigada() ? vigiaDeJogo.atual() : null,
  );

  /**
   * Abrir junto com o Windows.
   *
   * QUEM GUARDA A PREFERENCIA E O SISTEMA, nao um arquivo nosso: o registro de
   * inicializacao do Windows e a fonte da verdade. Ler de la em vez de manter
   * copia evita o caso em que a caixa aparece marcada e o app nao abre — a
   * pessoa pode ter tirado o Aether da inicializacao pelo Gerenciador de
   * Tarefas, e um valor nosso guardado continuaria dizendo que esta ligado.
   *
   * `openAsHidden` fica FALSO: abrir escondido junto com o sistema e o tipo de
   * coisa que faz a pessoa achar que o app nao abriu. Se um dia houver icone
   * na bandeja, ai vale reconsiderar.
   */
  ipcMain.handle("desktop:iniciar-com-windows-get", () => {
    try {
      return app.getLoginItemSettings().openAtLogin === true;
    } catch {
      // Plataforma sem suporte (ou politica bloqueando): responde desligado
      // em vez de derrubar a chamada.
      return false;
    }
  });

  ipcMain.handle("desktop:iniciar-com-windows-set", (_evento, ligar) => {
    const valor = ligar === true;
    try {
      app.setLoginItemSettings({ openAtLogin: valor, openAsHidden: false });
      // Devolve o que o SISTEMA passou a dizer, e nao o que pedimos: se ele
      // recusar, a tela precisa mostrar a verdade, nao a intencao.
      return app.getLoginItemSettings().openAtLogin === true;
    } catch (erro) {
      console.error("[inicio-automatico] falhou:", erro.message);
      return false;
    }
  });

  ipcMain.handle("desktop:game-detection-set", (_evento, ligada) => {
    const valor = ligada === true;
    salvarDeteccaoLigada(valor);
    if (valor) vigiaDeJogo.iniciar();
    else vigiaDeJogo.parar();
    return valor;
  });

  if (lerDeteccaoLigada()) vigiaDeJogo.iniciar();
}

/** A janela viva. O atualizador precisa dela para avisar da versao pronta. */
let janelaPrincipal = null;

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: "#0a0a0c",
    // Sem flash branco: a janela so aparece quando ha o que mostrar.
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "build", "icon.png"),

    /**
     * Barra de titulo propria, desenhada pela pagina.
     *
     * `hidden` + `titleBarOverlay`, e nao janela sem moldura com botoes
     * proprios: assim o Windows continua desenhando minimizar/maximizar/fechar
     * de verdade. O que se ganha com isso nao e estetica, e comportamento —
     * Snap Layouts (o menu de layout ao pousar o mouse no maximizar), duplo
     * clique para maximizar, area de clique correta e alta densidade. Botao
     * proprio significa reimplementar tudo isso, e errar em algum.
     *
     * A pagina desenha o resto da faixa e informa onde da para arrastar.
     */
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0b0d10",
      symbolColor: "#8a8f98",
      height: 36,
    },
    webPreferences: {
      /**
       * As tres linhas que importam para seguranca. O app carrega conteudo
       * REMOTO; sem isolamento, um comprometimento do site viraria execucao de
       * codigo com privilegio de desktop na maquina de quem instalou.
       */
      contextIsolation: true,
      nodeIntegration: false,
      /**
       * `sandbox: false` porque o preload usa `require("electron")` para o
       * contextBridge — com o sandbox ligado, o preload roda num contexto sem
       * `require` e a ponte nunca e criada.
       *
       * O que protege aqui e o `contextIsolation`: o mundo do site e o do
       * preload sao separados, e o site so alcanca o que o contextBridge
       * publica de proposito. Nada de Node vaza para a pagina.
       */
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  window.once("ready-to-show", () => window.show());
  void window.loadURL(APP_ORIGIN);

  // Devolvida para o atualizador poder avisar a pagina quando a versao nova
  // ficar pronta — o aviso agora e um botao dentro do app, nao caixa nativa.
  janelaPrincipal = window;

  /**
   * Link para fora abre no navegador do sistema, e nunca dentro do app. Sem
   * isto, um link em mensagem abriria uma janela Electron navegando para
   * qualquer lugar — com as permissoes de midia que a pessoa ja concedeu.
   */
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedUrl(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  return window;
}

/** Uma instancia so: a segunda foca a janela existente em vez de abrir outra. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (!existing) return;
    if (existing.isMinimized()) existing.restore();
    existing.focus();
  });

  void app.whenReady().then(() => {
    /**
     * Versoes no boot. O suporte a captura por loopback mudou bastante entre
     * versoes do Electron/Chromium, entao esta linha e a primeira coisa a
     * pedir quando alguem relatar problema de som.
     */
    console.log("[runtime]", {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    });

    /**
     * Microfone, captura de tela e TELA CHEIA sao concedidos sem perguntar;
     * camera entrou quando o recurso passou a existir. Todo o resto e NEGADO,
     * porque permissao que nao se usa e superficie de ataque de graca.
     *
     * `fullscreen` estava faltando, e o sintoma era mudo: no Electron, o
     * `Element.requestFullscreen()` da pagina passa por AQUI como permissao
     * `"fullscreen"`. Negada, a promessa e rejeitada — e o botao da tela
     * engolia o erro num `.catch`, entao clicar simplesmente nao fazia nada.
     * O codigo do botao nunca mudou; quem mudou foi esta lista.
     *
     * A lista de permitidas fica numa constante so, usada pelos DOIS handlers
     * abaixo: eles respondem perguntas diferentes sobre a mesma politica, e
     * duas listas divergiriam na proxima vez que alguem mexesse em uma.
     */
    const PERMISSOES_LIBERADAS = new Set([
      "media",
      "display-capture",
      "fullscreen",
    ]);

    /**
     * Nao ha dialogo de permissao aqui de proposito: quem instalou um
     * aplicativo de voz ja consentiu em usar o microfone, e o Windows continua
     * mostrando o indicador de microfone em uso.
     */
    session.defaultSession.setPermissionRequestHandler(
      (webContents, permission, callback) => {
        const url = webContents?.getURL() ?? "";
        if (!isAllowedUrl(url)) {
          callback(false);
          return;
        }
        callback(PERMISSOES_LIBERADAS.has(permission));
      },
    );

    /**
     * O handler de VERIFICACAO, que e outro e nao pode faltar.
     *
     * O Chromium pergunta duas coisas em momentos diferentes: "posso PEDIR?"
     * (acima) e "esta permitido AGORA?" (aqui). O padrao do Electron nega o
     * segundo para camera vindo de conteudo remoto — e sem ele o microfone
     * funcionava e a camera nao, com um erro que nao explicava nada:
     *
     *   navigator.permissions.query({name:"camera"}) -> "denied"
     *   getUserMedia({video:true}) -> NotAllowedError: Permission denied
     *
     * A origem e conferida do mesmo jeito: so o app, nunca uma pagina
     * qualquer que consiga se carregar aqui dentro.
     */
    session.defaultSession.setPermissionCheckHandler(
      (webContents, permission, requestingOrigin) => {
        const url = webContents?.getURL() ?? requestingOrigin ?? "";
        if (!isAllowedUrl(url)) return false;
        return PERMISSOES_LIBERADAS.has(permission);
      },
    );

    installDisplayMediaHandler(session.defaultSession);

    /**
     * O renderer avisa aqui quando `getDisplayMedia` rejeitou por causa do
     * SOM (video teria funcionado). E o unico jeito de saber: o pedido de
     * loopback e feito por este processo, mas quem realmente tenta abrir o
     * dispositivo de audio e o Chromium, depois que o callback do handler ja
     * retornou — o main nunca veria a falha sozinho.
     */
    ipcMain.on("desktop:audio-capture-failed", (_evento, detalhes) =>
      disableAudioPreference(detalhes),
    );

    instalarDeteccaoDeJogo();
    instalarLoopback();
    createWindow();

    // Depois da janela: a verificacao nao pode atrasar a abertura do app.
    instalarAtualizador(janelaPrincipal);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    // No Windows e Linux, fechar a janela encerra o app.
    if (process.platform !== "darwin") app.quit();
  });

  /**
   * A thread de captura de som precisa morrer ANTES do processo.
   *
   * Sem isto, fechar o app durante um compartilhamento deixaria a thread
   * nativa segurando o dispositivo de audio — e o proximo `Initialize` no
   * WASAPI poderia falhar por recurso ocupado, num erro que pareceria vir do
   * nada na proxima abertura do app.
   */
  app.on("will-quit", () => encerrarLoopback());
}
