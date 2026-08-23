"use strict";

/**
 * Diagnostico da captura de SOM DO SISTEMA no compartilhamento de tela.
 *
 * POR QUE EXISTE: numa maquina o `getDisplayMedia` com som falha com
 * `Could not start audio source`, e hoje o app engole o erro — desliga o som e
 * segue. Isso deixa "nao funciona" sem nenhuma informacao sobre a causa.
 *
 * O que ja sabemos, e que este script assume:
 *
 *  - o loopback WASAPI FUNCIONA no dispositivo (verificado gravando um clipe
 *    pelo Xbox Game Bar, que usa exatamente esse caminho). Ou seja, o aparelho
 *    nao recusa captura;
 *  - logo, quem falha e a camada do Chromium — provavelmente na NEGOCIACAO DE
 *    FORMATO, nao no acesso ao dispositivo.
 *
 * Este script nao conserta nada. Ele TENTA cada caminho disponivel e diz qual
 * passou, com o erro exato de cada um — que e a informacao que falta para
 * decidir entre um ajuste de uma linha e um modulo nativo em C++.
 *
 * NAO faz parte do app: roda sozinho, nao importa nada de `src/`, e nao mexe
 * em preferencia nenhuma.
 *
 * Uso:
 *   npm run diagnose:audio --workspace=@aether/desktop
 *   npm run diagnose:audio --workspace=@aether/desktop -- --canais
 *
 * O `--canais` religa a aplicacao com a chave `--try-supported-channel-layouts`
 * do Chromium, que precisa existir ANTES do app ficar pronto.
 */

const { app, BrowserWindow, desktopCapturer, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * A chave precisa ser adicionada antes do `ready`, por isso e lida do argv
 * aqui em cima em vez de dentro do fluxo.
 *
 * O que ela faz: por padrao o Chromium assume o layout de canais do hardware.
 * Com ela, ele PERGUNTA ao driver quais layouts sao suportados. Se a teoria de
 * formato estiver certa, e a candidata mais direta a resolver.
 */
const TENTAR_LAYOUTS = process.argv.includes("--canais");
if (TENTAR_LAYOUTS) {
  app.commandLine.appendSwitch("try-supported-channel-layouts");
}

/** O que o handler do Electron deve devolver na tentativa da vez. */
let modoAtual = null;
let fonteAtual = null;

const resultados = [];

function registrar(nome, ok, detalhe) {
  resultados.push({ nome, ok, detalhe });
  console.log(`  ${ok ? "PASSOU" : "falhou"}  ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}

/**
 * Roda um pedaco de codigo no renderer COM gesto de usuario.
 *
 * O terceiro argumento e o que importa: `getDisplayMedia` exige ativacao por
 * gesto, e sem ele toda tentativa morreria com `NotAllowedError` — o que
 * pareceria "recusado" quando na verdade nem chegou a tentar.
 */
function noRenderer(janela, codigo) {
  return janela.webContents.executeJavaScript(codigo, true);
}

/** Descreve um erro do renderer sem perder o que importa. */
const CAPTURA = `
  (async () => {
    try {
      const stream = await PEDIDO;
      const audio = stream.getAudioTracks();
      const video = stream.getVideoTracks();
      const info = audio[0]
        ? { label: audio[0].label, settings: audio[0].getSettings() }
        : null;
      for (const t of stream.getTracks()) t.stop();
      return {
        ok: audio.length > 0,
        faixasDeAudio: audio.length,
        faixasDeVideo: video.length,
        audio: info,
      };
    } catch (erro) {
      return {
        ok: false,
        erro: { nome: erro.name, mensagem: erro.message, tipo: String(erro) },
      };
    }
  })()
`;

function pedido(expressao) {
  return CAPTURA.replace("PEDIDO", expressao);
}

async function main() {
  const janela = new BrowserWindow({
    width: 700,
    height: 420,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  /**
   * Carregado de `file://`, e nao de `data:`.
   *
   * `data:` produz origem opaca, que NAO e contexto seguro — e sem contexto
   * seguro o Chromium nem publica `navigator.mediaDevices`. A primeira versao
   * deste script morria ali, e o erro ("Script failed to execute") nao dizia
   * nada sobre a causa. `file://` o Chromium trata como confiavel.
   */
  const pagina = path.join(os.tmpdir(), "aether-diagnostico-audio.html");
  fs.writeFileSync(pagina, "<!doctype html><title>diagnostico</title>", "utf8");
  await janela.loadFile(pagina);

  const temMediaDevices = await noRenderer(
    janela,
    "typeof navigator.mediaDevices === 'object'",
  );
  if (!temMediaDevices) {
    console.log(
      "\nnavigator.mediaDevices nao existe nesta pagina — sem contexto seguro.",
    );
    app.quit();
    return;
  }

  /**
   * O handler devolve o que a tentativa da vez pedir. Fica registrado uma vez
   * so: registrar de novo a cada tentativa substituiria o anterior e daria
   * comportamento confuso.
   */
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (!fonteAtual || !modoAtual) {
        callback({});
        return;
      }
      const resposta = { video: fonteAtual };
      if (modoAtual !== "sem-audio") resposta.audio = modoAtual;
      callback(resposta);
    },
    { useSystemPicker: false },
  );

  console.log("\n=================================================");
  console.log(" Diagnostico do som do compartilhamento de tela");
  console.log("=================================================");
  console.log(`Electron ........ ${process.versions.electron}`);
  console.log(`Chromium ........ ${process.versions.chrome}`);
  console.log(`Windows ......... ${require("node:os").release()}`);
  console.log(
    `Chave de canais . ${TENTAR_LAYOUTS ? "LIGADA (--try-supported-channel-layouts)" : "desligada"}`,
  );

  // ---------------------------------------------------------------
  console.log("\nDispositivos que o Chromium enxerga");

  const dispositivos = await noRenderer(
    janela,
    `navigator.mediaDevices.enumerateDevices().then((ds) =>
       ds.map((d) => ({ tipo: d.kind, id: d.deviceId, rotulo: d.label })))`,
  );
  const saidas = dispositivos.filter((d) => d.tipo === "audiooutput");
  if (saidas.length === 0) {
    console.log("  (nenhuma saida listada — rotulos exigem permissao de midia)");
  }
  for (const d of saidas) {
    console.log(`  saida    ${d.id === "default" ? "[PADRAO] " : ""}${d.rotulo || "(sem rotulo)"}`);
  }
  const entradas = dispositivos.filter((d) => d.tipo === "audioinput");
  for (const d of entradas) {
    console.log(`  entrada  ${d.rotulo || "(sem rotulo)"}`);
  }

  // ---------------------------------------------------------------
  const fontes = await desktopCapturer.getSources({ types: ["screen"] });
  if (fontes.length === 0) {
    console.log("\nNenhuma tela para capturar. Abortando.");
    app.quit();
    return;
  }
  fonteAtual = fontes[0];
  console.log(`\nCapturando de: ${fonteAtual.name}`);

  // ---------------------------------------------------------------
  console.log("\nTentativa 1 — o caminho ATUAL do app (audio: 'loopback')");
  modoAtual = "loopback";
  const r1 = await noRenderer(
    janela,
    pedido("navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })"),
  );
  registrar(
    "loopback",
    r1.ok,
    r1.ok ? `faixa: ${r1.audio?.label ?? "?"}` : `${r1.erro?.nome}: ${r1.erro?.mensagem}`,
  );

  // ---------------------------------------------------------------
  console.log("\nTentativa 2 — 'loopbackWithMute'");
  console.log("  (mesma familia; silencia a saida local enquanto captura)");
  modoAtual = "loopbackWithMute";
  const r2 = await noRenderer(
    janela,
    pedido("navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })"),
  );
  registrar(
    "loopbackWithMute",
    r2.ok,
    r2.ok ? `faixa: ${r2.audio?.label ?? "?"}` : `${r2.erro?.nome}: ${r2.erro?.mensagem}`,
  );

  // ---------------------------------------------------------------
  /**
   * O caminho LEGADO — `getUserMedia({ audio: { mandatory: {
   * chromeMediaSource: "desktop" } } })` — foi testado aqui e REMOVIDO. Nao
   * porque falhou: porque MATA O RENDERER.
   *
   *   ERROR:bad_message.cc(29) Terminating renderer for bad IPC message,
   *   reason 263
   *
   * No Chromium 130 essa constraint nao e ignorada; ela e tratada como
   * mensagem malformada e o processo e encerrado na hora — derrubando junto o
   * servico de rede e a GPU. Levar isso ao app significaria a janela morrer no
   * clique de compartilhar.
   *
   * Fica escrito para ninguem ressuscitar a ideia achando que so faltou
   * tentar. Foi tentada, em 23/08/2026, no Electron 33.4.11.
   */

  // ---------------------------------------------------------------
  console.log("\nTentativa 3 — controle: SEM som");
  console.log("  (prova que o video sozinho funciona, isolando a causa no audio)");
  modoAtual = "sem-audio";
  const r4 = await noRenderer(
    janela,
    pedido("navigator.mediaDevices.getDisplayMedia({ audio: false, video: true })"),
  );
  registrar(
    "video sozinho",
    r4.faixasDeVideo > 0,
    r4.faixasDeVideo > 0 ? "video ok" : `${r4.erro?.nome}: ${r4.erro?.mensagem}`,
  );

  // ---------------------------------------------------------------
  console.log("\n-------------------------------------------------");
  const comSom = resultados.filter((r) => r.ok && r.nome !== "video sozinho");
  if (comSom.length > 0) {
    console.log("RESULTADO: ha caminho que funciona ->");
    for (const r of comSom) console.log(`  * ${r.nome}`);
    console.log("\nConserto de uma linha. Nao precisa de modulo nativo.");
  } else if (!TENTAR_LAYOUTS) {
    console.log("RESULTADO: nenhum dos caminhos do Chromium trouxe som.");
    console.log("\nFalta a ultima tentativa barata — rode de novo com a chave");
    console.log("de layout de canais, que ataca a hipotese de formato:");
    console.log("\n  npm run diagnose:audio --workspace=@aether/desktop -- --canais\n");
  } else {
    console.log("RESULTADO: nenhum caminho do Chromium funciona, nem com a");
    console.log("chave de layout de canais.");
    console.log("\nComo o Game Bar GRAVA som deste mesmo dispositivo, o loopback");
    console.log("do Windows funciona e quem falha e o Chromium. Sobra o modulo");
    console.log("nativo (WASAPI com o GetMixFormat do proprio dispositivo).");
  }
  console.log("-------------------------------------------------\n");

  janela.destroy();
  app.quit();
}

app.whenReady().then(() =>
  main().catch((erro) => {
    console.error("\nO diagnostico quebrou:", erro);
    app.quit();
  }),
);

app.on("window-all-closed", () => app.quit());
