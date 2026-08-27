"use strict";

/**
 * O TESTE DO ECO DE VERDADE, no lugar onde ele acontece.
 *
 * Os testes anteriores tocavam o som por um processo filho lancado com
 * PowerShell. Isso prova a exclusao de arvore em geral, mas NAO prova o caso
 * do app: quem toca a voz da call e o servico de audio do CHROMIUM, um
 * processo utilitario que o Electron sobe sozinho. Se ele nao contar como
 * parte da nossa arvore para a API do Windows, a exclusao nao vale de nada e
 * o eco continua — exatamente o que foi relatado.
 *
 * Entao aqui o som sai de uma janela do Chromium, via Web Audio, igualzinho a
 * voz que chega pela call. Se o tom aparecer na captura, a exclusao nao cobre
 * o servico de audio, e o conserto esta no lugar errado.
 *
 * Uso:
 *   npx electron apps/desktop/native/testar-eco-real.js
 */
const { app, BrowserWindow } = require("electron");
const loopback = require("./index");

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function pico(buffer) {
  let maior = 0;
  for (let i = 0; i + 4 <= buffer.length; i += 4) {
    const v = Math.abs(buffer.readFloatLE(i));
    if (v > maior) maior = v;
  }
  return maior;
}

async function medir(sessao, ms) {
  sessao.read();
  let maior = 0;
  let bytes = 0;
  const ate = Date.now() + ms;
  while (Date.now() < ate) {
    await dormir(150);
    const pedaco = sessao.read();
    if (pedaco && pedaco.length) {
      bytes += pedaco.length;
      const p = pico(pedaco);
      if (p > maior) maior = p;
    }
  }
  return { maior, bytes };
}

/**
 * Uma janela escondida tocando um tom continuo pelo Web Audio.
 *
 * E o analogo mais fiel da voz da call: mesmo processo, mesmo servico de
 * audio do Chromium, mesma saida do Windows.
 */
async function abrirTom() {
  const janela = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: false },
  });
  const pagina = `
    <script>
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const ganho = ctx.createGain();
      osc.frequency.value = 440;
      ganho.gain.value = 0.25;
      osc.connect(ganho).connect(ctx.destination);
      osc.start();
    </script>`;
  await janela.loadURL("data:text/html," + encodeURIComponent(pagina));
  return janela;
}

app.whenReady().then(async () => {
  console.log(`electron ${process.versions.electron} | pid ${process.pid}\n`);

  if (!loopback.disponivel()) {
    console.log("NAO CARREGOU:", loopback.indisponivelPorque());
    app.exit(1);
    return;
  }

  const sessao = loopback.abrir();
  sessao.start();
  const formato = sessao.format();
  console.log("formato:", JSON.stringify(formato));

  if (formato.semEco !== true) {
    console.log("\n  ATENCAO  a captura NAO entrou no modo por processo.");
    console.log("           caiu no loopback de dispositivo — o eco e esperado.");
  }

  const silencio = await medir(sessao, 2500);
  console.log(`\nsilencio                -> pico ${silencio.maior.toFixed(5)}`);

  const janela = await abrirTom();
  await dormir(1200); // deixa o audio realmente comecar
  const tocando = await medir(sessao, 3000);
  console.log(`tom do PROPRIO Chromium -> pico ${tocando.maior.toFixed(5)}`);

  janela.destroy();
  sessao.stop();

  const subiu = tocando.maior - silencio.maior;
  console.log(`\ndiferenca: ${subiu.toFixed(5)}`);

  if (subiu < 0.02) {
    console.log("\n  ok     o som do proprio app NAO entra na captura.");
    console.log("         a exclusao cobre o servico de audio do Chromium.");
  } else {
    console.log("\n  FALHA  o som do PROPRIO app vazou para a captura.");
    console.log("         e por isso que a outra pessoa ouve a propria voz:");
    console.log("         a exclusao nao esta pegando o servico de audio.");
    process.exitCode = 1;
  }

  app.exit(subiu < 0.02 ? 0 : 1);
});
