"use strict";

/**
 * O Chromium entrega faixa de audio quando o RENDERER pediu `audio: false`,
 * mas o handler do Electron respondeu `audio: "loopback"`?
 *
 * POR QUE ISTO IMPORTA: quando o modulo nativo esta disponivel, o app pede
 * `audio: false` de proposito — o som vai vir por fora, ja sem o proprio
 * Aether dentro. Mas o handler de tela do processo principal devolve
 * `audio: "loopback"` sempre que a caixa do SELETOR estiver marcada, sem
 * olhar o que o renderer pediu.
 *
 * Se nessa combinacao vier uma faixa, ela e loopback DE DISPOSITIVO — com a
 * call inteira dentro — e o app a publica logo abaixo da nativa. A pessoa do
 * outro lado ouviria a propria voz de volta mesmo com a exclusao funcionando,
 * porque existiriam DUAS faixas de som da tela.
 *
 * O codigo afirma que isso nao acontece, num comentario. Este script mede.
 *
 * Uso:
 *   npx electron apps/desktop/native/testar-faixa-dupla.js
 */
const { app, BrowserWindow, desktopCapturer } = require("electron");
const http = require("node:http");

/**
 * Um servidor de uma pagina so, em localhost.
 *
 * `getDisplayMedia` exige CONTEXTO SEGURO. Um `data:` URL nao e, e ali
 * `navigator.mediaDevices` nem existe — foi o que a primeira versao deste
 * teste descobriu. `http://127.0.0.1` conta como seguro.
 */
function servir() {
  return new Promise((resolve) => {
    const servidor = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>teste</body></html>");
    });
    servidor.listen(0, "127.0.0.1", () => resolve(servidor));
  });
}

app.whenReady().then(async () => {
  const janela = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false },
  });

  const fontes = await desktopCapturer.getSources({ types: ["screen"] });
  const tela = fontes[0];
  if (!tela) {
    console.log("sem fonte de tela para testar");
    app.exit(1);
    return;
  }

  const resultados = {};

  function instalarHandler(comAudio) {
    janela.webContents.session.setDisplayMediaRequestHandler((pedido, callback) => {
      resultados.audioRequested = pedido.audioRequested;
      const resposta = { video: tela };
      // Exatamente o que o app faz: devolve loopback quando o SELETOR quer,
      // independente do que o renderer pediu.
      if (comAudio) resposta.audio = "loopback";
      callback(resposta);
    });
  }

  async function pedir(audioNoRenderer) {
    return janela.webContents.executeJavaScript(`
      (async () => {
        try {
          const s = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: ${audioNoRenderer},
          });
          const r = {
            video: s.getVideoTracks().length,
            audio: s.getAudioTracks().length,
            rotuloDoAudio: s.getAudioTracks()[0]?.label ?? null,
          };
          s.getTracks().forEach((t) => t.stop());
          return r;
        } catch (e) {
          return { erro: e.name + ": " + e.message };
        }
      })()
    `, true);
  }

  const servidor = await servir();
  const porta = servidor.address().port;
  await janela.loadURL(`http://127.0.0.1:${porta}/`);

  console.log("caso 1 — renderer pede audio:false, handler devolve loopback");
  instalarHandler(true);
  const caso1 = await pedir(false);
  console.log("   ->", JSON.stringify(caso1));

  console.log("\ncaso 2 — renderer pede audio:true, handler devolve loopback");
  instalarHandler(true);
  const caso2 = await pedir(true);
  console.log("   ->", JSON.stringify(caso2));

  console.log("\ncaso 3 — renderer pede audio:true, handler NAO devolve audio");
  instalarHandler(false);
  const caso3 = await pedir(true);
  console.log("   ->", JSON.stringify(caso3));

  console.log("\n=== conclusao ===");
  if (caso1.erro || caso2.erro) {
    console.log("  INCONCLUSIVO — a captura nem chegou a acontecer:");
    console.log("   ", caso1.erro ?? caso2.erro);
  } else if (caso1.audio > 0) {
    console.log("  FALHA  com audio:false no renderer VEIO faixa de audio.");
    console.log("         essa faixa e loopback de dispositivo, com a call");
    console.log("         dentro — e o app a publica junto da nativa.");
    console.log("         e a segunda fonte do eco.");
  } else {
    console.log("  ok     audio:false no renderer nao traz faixa nenhuma.");
    console.log("         o comentario do codigo esta correto neste ponto.");
  }

  janela.destroy();
  servidor.close();
  app.exit(0);
});
