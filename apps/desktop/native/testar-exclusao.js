"use strict";

/**
 * Prova a EXCLUSAO em si: o som que sai do proprio Aether nao entra na captura.
 *
 * O teste anterior (`testar-sem-eco.js`) mostra que o modo ativou e que o som
 * dos outros programas continua chegando. Nenhum dos dois prova o que importa
 * para o eco — que o NOSSO som fica de fora.
 *
 * Como este prova: toca um WAV do Windows a partir de um processo FILHO deste.
 * Filho esta na mesma arvore, e a captura pediu
 * `EXCLUDE_TARGET_PROCESS_TREE` — entao esse som tem de sumir. E o mesmo
 * mecanismo que, no app, faz a voz da call ficar de fora: no Chromium quem
 * toca audio e um processo filho do principal, nao ele mesmo.
 *
 * Medimos em DUAS janelas para a comparacao ser interna ao teste:
 *   - silencio: nada tocando, so o piso de ruido
 *   - tocando:  o filho tocando o WAV
 *
 * Se a exclusao funciona, as duas medidas ficam parecidas. Se falha, a
 * segunda dispara.
 *
 * Uso (de preferencia com NADA mais tocando na maquina):
 *   node apps/desktop/native/testar-exclusao.js
 */
const { spawn } = require("node:child_process");
const loopback = require("./index");

const WAV = "C:\\Windows\\Media\\Alarm01.wav";

function picoFloat32(buffer) {
  let maior = 0;
  for (let i = 0; i + 4 <= buffer.length; i += 4) {
    const v = Math.abs(buffer.readFloatLE(i));
    if (v > maior) maior = v;
  }
  return maior;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function medir(sessao, ms) {
  sessao.read(); // descarta o que ficou da janela anterior
  let maior = 0;
  let bytes = 0;
  const ate = Date.now() + ms;
  while (Date.now() < ate) {
    await dormir(150);
    const pedaco = sessao.read();
    if (pedaco && pedaco.length) {
      bytes += pedaco.length;
      const p = picoFloat32(pedaco);
      if (p > maior) maior = p;
    }
  }
  return { maior, bytes };
}

/** Toca o WAV num processo FILHO, varias vezes, e devolve como parar. */
function tocarNoFilho() {
  const filho = spawn(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$p = New-Object Media.SoundPlayer '${WAV}'; 1..6 | ForEach-Object { $p.PlaySync() }`,
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  return () => {
    try {
      filho.kill();
    } catch {
      /* ja morreu */
    }
  };
}

async function main() {
  const sessao = loopback.abrir();
  sessao.start();
  const formato = sessao.format();

  if (formato.semEco !== true) {
    console.log("PULADO: a captura caiu no loopback de dispositivo.");
    console.log("Sem o modo por processo nao ha exclusao para testar.");
    sessao.stop();
    return;
  }

  console.log("modo por processo ativo — arvore deste processo EXCLUIDA\n");

  const silencio = await medir(sessao, 2000);
  console.log(`silencio  -> pico ${silencio.maior.toFixed(5)}`);

  const parar = tocarNoFilho();
  await dormir(600); // deixa o som comecar de fato
  const tocando = await medir(sessao, 3000);
  parar();
  sessao.stop();

  console.log(`tocando   -> pico ${tocando.maior.toFixed(5)}  (WAV num processo FILHO)`);

  const subiu = tocando.maior - silencio.maior;
  console.log(`\ndiferenca: ${subiu.toFixed(5)}`);

  /**
   * O corte e generoso de proposito. Nao afirmamos "capturou zero" — o piso de
   * ruido da maquina varia e outro programa pode tocar algo no meio. O que a
   * exclusao promete e que o NOSSO som nao aparece, e um WAV de alarme tocando
   * apareceria com folga acima disto.
   */
  if (subiu < 0.02) {
    console.log("\n  ok     o som da nossa arvore NAO entrou na captura.");
    console.log("         e isto que tira o eco da call.");
  } else {
    console.log("\n  FALHA  o som do proprio processo VAZOU para a captura.");
    console.log("         a exclusao nao esta valendo — o eco continuaria.");
    process.exitCode = 1;
  }
}

main().catch((erro) => {
  console.error("erro:", erro);
  process.exitCode = 1;
});
