"use strict";

/**
 * As APIs do Electron que o `main.js` usa ainda existem nesta versao?
 *
 * POR QUE ISTO EXISTE: subir de major (33 -> 44 sao ONZE) e onde API some ou
 * muda de assinatura. O app instalado nao pode ser aberto para testar sem
 * fechar o que a pessoa esta usando, entao esta e a checagem que da para fazer
 * sem atrapalhar ninguem.
 *
 * NAO substitui abrir o app. Ele prova que as funcoes existem e sao chamaveis,
 * nao que a janela desenha certo nem que o seletor de tela abre. Isso continua
 * precisando de um teste humano — e esta anotado como tal.
 *
 * Uso:
 *   npx electron apps/desktop/native/testar-apis-electron.js
 */
const {
  app,
  BrowserWindow,
  session,
  ipcMain,
  desktopCapturer,
  Tray,
  Menu,
  nativeImage,
  shell,
} = require("electron");

let passou = 0;
let falhou = 0;

function checar(rotulo, condicao, detalhe = "") {
  if (condicao) {
    passou += 1;
    console.log(`  ok    ${rotulo}`);
  } else {
    falhou += 1;
    console.log(`  FALHA ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

app.whenReady().then(async () => {
  console.log(`\nElectron ${process.versions.electron} | Chromium ${process.versions.chrome} | Node ${process.versions.node}\n`);

  console.log("Modulos que o main.js importa");
  checar("app", typeof app === "object");
  checar("BrowserWindow", typeof BrowserWindow === "function");
  checar("session", typeof session === "object");
  checar("ipcMain", typeof ipcMain === "object");
  checar("desktopCapturer", typeof desktopCapturer === "object");
  checar("Tray", typeof Tray === "function");
  checar("Menu", typeof Menu === "function");
  checar("nativeImage", typeof nativeImage === "object");
  checar("shell", typeof shell === "object");

  console.log("\nMetodos que o app chama por nome");
  checar(
    "app.setLoginItemSettings (abrir com o Windows)",
    typeof app.setLoginItemSettings === "function",
  );
  checar(
    "app.getLoginItemSettings",
    typeof app.getLoginItemSettings === "function",
  );
  checar(
    "app.requestSingleInstanceLock",
    typeof app.requestSingleInstanceLock === "function",
  );
  checar("app.getPath", typeof app.getPath === "function");
  checar("app.isPackaged existe", typeof app.isPackaged === "boolean");

  const ses = session.defaultSession;
  checar(
    "session.setPermissionRequestHandler",
    typeof ses.setPermissionRequestHandler === "function",
  );
  checar(
    "session.setPermissionCheckHandler",
    typeof ses.setPermissionCheckHandler === "function",
  );
  checar(
    "session.setDisplayMediaRequestHandler (compartilhar tela)",
    typeof ses.setDisplayMediaRequestHandler === "function",
  );
  checar(
    "desktopCapturer.getSources",
    typeof desktopCapturer.getSources === "function",
  );

  console.log("\nA janela, com as opcoes que o app usa");
  let janela = null;
  try {
    janela = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      minWidth: 940,
      minHeight: 600,
      backgroundColor: "#0a0a0c",
      autoHideMenuBar: true,
      /**
       * A barra de titulo propria e o que mais costuma quebrar entre majors:
       * `titleBarOverlay` e uma opcao relativamente nova e ja mudou de forma
       * uma vez.
       */
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#0b0d10", symbolColor: "#8a8f98", height: 36 },
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    checar("criar BrowserWindow com titleBarOverlay", true);
    checar(
      "setTitleBarOverlay ainda existe",
      typeof janela.setTitleBarOverlay === "function",
    );
    checar(
      "contextIsolation ficou LIGADO",
      janela.webContents.getLastWebPreferences()?.contextIsolation !== false,
    );
  } catch (erro) {
    checar("criar BrowserWindow com titleBarOverlay", false, erro.message);
  }

  console.log("\nO seletor de tela consegue listar fontes");
  try {
    const fontes = await desktopCapturer.getSources({ types: ["screen"] });
    checar(
      "desktopCapturer devolve pelo menos uma tela",
      fontes.length > 0,
      `veio ${fontes.length}`,
    );
  } catch (erro) {
    checar("desktopCapturer devolve pelo menos uma tela", false, erro.message);
  }

  if (janela) janela.destroy();

  console.log(`\n${passou} passaram, ${falhou} falharam`);
  if (falhou > 0) {
    console.log(
      "\nATENCAO: isto so prova que as APIs existem. Abrir o app de verdade\n" +
        "continua sendo necessario antes de distribuir.",
    );
  }
  app.exit(falhou === 0 ? 0 : 1);
});
