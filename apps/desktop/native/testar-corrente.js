"use strict";

/**
 * A corrente INTEIRA, menos o LiveKit: captura nativa -> IPC -> AudioWorklet
 * -> MediaStreamTrack, com medicao de nivel no fim.
 *
 * Cada peca ja foi testada sozinha. O que so este teste responde e se elas se
 * ligam: o PCM chega do outro lado da ponte, o worklet carrega, o ring buffer
 * entrega no ritmo do relogio de audio, e a faixa que sai tem SOM — nao
 * silencio bem formatado.
 *
 * Precisa do servidor web no ar (`npm run dev`), porque o worklet e servido
 * de `/loopback-worklet.js` e `AudioWorklet` exige contexto seguro.
 *
 * Uso:
 *   npx electron apps/desktop/native/testar-corrente.js
 */
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const { instalarLoopback, encerrarLoopback } = require("../src/loopback-ipc");

const SEGUNDOS = 4;

app.on("window-all-closed", () => undefined);

app.whenReady().then(async () => {
  instalarLoopback();

  const janela = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "..", "src", "preload.js"),
    },
  });

  console.log("\n=================================================");
  console.log(" Corrente completa: nativo -> IPC -> worklet -> track");
  console.log("=================================================");

  try {
    await janela.loadURL("http://localhost:3000/login");
  } catch (erro) {
    console.log(`\nservidor web fora do ar: ${erro.message}`);
    console.log("suba com: npm run dev\n");
    app.exit(1);
    return;
  }

  const resultado = await janela.webContents.executeJavaScript(
    `
    (async () => {
      const api = window.aetherDesktop && window.aetherDesktop.loopback;
      if (!api) return { erro: "a ponte aetherDesktop.loopback nao existe" };

      const d = await api.disponivel();
      if (!d.disponivel) return { erro: "nativo indisponivel: " + d.motivo };

      const saidas = await api.saidas();
      const padrao = saidas.find((s) => s.isDefault) || saidas[0];
      if (!padrao) return { erro: "nenhuma saida de audio" };

      const inicio = await api.iniciar(padrao.id);
      if (!inicio.ok) return { erro: "start falhou: " + inicio.erro };

      const taxa = inicio.formato.sampleRate;
      const contexto = new AudioContext({ sampleRate: taxa });
      await contexto.audioWorklet.addModule("/loopback-worklet.js");

      const no = new AudioWorkletNode(contexto, "loopback-processor", {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      });
      const destino = contexto.createMediaStreamDestination();
      const analisador = contexto.createAnalyser();
      analisador.fftSize = 2048;
      no.connect(analisador);
      no.connect(destino);

      let relatorio = null;
      no.port.onmessage = (e) => { relatorio = e.data; };

      let pedacos = 0, bytes = 0;
      const cancelar = api.aoReceber((pedaco) => {
        pedacos++;
        bytes += pedaco.byteLength;
        const b = pedaco instanceof Uint8Array ? pedaco : new Uint8Array(pedaco);
        const amostras = new Float32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
        no.port.postMessage(new Float32Array(amostras));
      });

      const track = destino.stream.getAudioTracks()[0];

      // Mede o nivel da faixa que SAIU, nao do que entrou.
      const dados = new Float32Array(analisador.fftSize);
      let picoDaFaixa = 0;
      const ate = Date.now() + ${SEGUNDOS} * 1000;
      while (Date.now() < ate) {
        await new Promise((r) => setTimeout(r, 100));
        analisador.getFloatTimeDomainData(dados);
        for (let i = 0; i < dados.length; i++) {
          const v = Math.abs(dados[i]);
          if (v > picoDaFaixa) picoDaFaixa = v;
        }
      }

      cancelar();
      no.port.postMessage("encerrar");
      no.disconnect();
      await api.parar();
      const estado = track ? track.readyState : "sem faixa";
      await contexto.close();

      return {
        aparelho: padrao.name,
        taxa,
        canaisDaCaptura: inicio.formato.channels,
        canaisDoAparelho: inicio.formato.origem.channels,
        misturado: inicio.formato.origem.downmix,
        pedacos, bytes,
        faixa: track ? { tipo: track.kind, estado, ativa: track.enabled } : null,
        picoDaFaixa,
        relatorio,
      };
    })()
    `,
    true,
  );

  if (resultado.erro) {
    console.log(`\nFALHOU: ${resultado.erro}\n`);
    encerrarLoopback();
    app.exit(1);
    return;
  }

  const r = resultado;
  console.log(`\naparelho: ${r.aparelho}`);
  console.log(
    `formato: ${r.taxa} Hz | aparelho ${r.canaisDoAparelho} canais -> ` +
      `captura ${r.canaisDaCaptura}${r.misturado ? " (misturado)" : ""}`,
  );
  console.log(
    `\nIPC: ${r.pedacos} pedacos, ${(r.bytes / 1024).toFixed(0)} KB em ${SEGUNDOS}s`,
  );
  console.log(
    `faixa: ${r.faixa ? `${r.faixa.tipo}, ${r.faixa.estado}, ativa=${r.faixa.ativa}` : "NAO CRIADA"}`,
  );
  if (r.relatorio) {
    console.log(
      `worklet: ${r.relatorio.disponivel} quadros na fila, ` +
        `${r.relatorio.faltas} faltas, ${r.relatorio.descartes} descartes`,
    );
  }
  console.log(
    r.picoDaFaixa > 0.0005
      ? `\nA FAIXA TEM SOM — pico ${r.picoDaFaixa.toFixed(4)}`
      : `\nfaixa criada, porem SILENCIO (nada tocando nesta saida?)`,
  );

  const ok =
    r.pedacos > 0 && r.faixa && r.faixa.estado === "live" && r.picoDaFaixa > 0.0005;
  console.log(ok ? "\nCORRENTE COMPLETA OK" : "\nalgo na corrente nao fechou");
  console.log("-------------------------------------------------\n");

  encerrarLoopback();
  janela.destroy();
  app.exit(ok ? 0 : 1);
});
