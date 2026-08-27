"use strict";

/**
 * Prova que a captura do som da tela NAO leva junto o som do proprio Aether.
 *
 * Esta e a verificacao do eco. O compartilhamento de tela com som usava
 * loopback do DISPOSITIVO, que captura tudo o que sai da maquina — inclusive
 * a call. Quem compartilhava devolvia a voz das outras pessoas para elas
 * mesmas, atrasada: o que se ouve como eco.
 *
 * O conserto e capturar por PROCESSO, excluindo a nossa propria arvore. Este
 * script responde duas perguntas, e a segunda e a que importa:
 *
 *   1. o modo sem eco ATIVOU nesta maquina? (`semEco: true`)
 *   2. ele ainda entrega o som dos OUTROS programas?
 *
 * A segunda existe porque "nao capturar nada" tambem passaria na primeira, e
 * seria uma regressao pior que o eco.
 *
 * COMO RODAR — deixe uma musica ou video TOCANDO em outro programa:
 *   node apps/desktop/native/testar-sem-eco.js
 */
const loopback = require("./index");

const SEGUNDOS = 4;

function picoFloat32(buffer) {
  let maior = 0;
  for (let i = 0; i + 4 <= buffer.length; i += 4) {
    const v = Math.abs(buffer.readFloatLE(i));
    if (v > maior) maior = v;
  }
  return maior;
}

async function main() {
  const sessao = loopback.abrir();
  sessao.start();

  const formato = sessao.format();
  console.log("formato:", JSON.stringify(formato));
  console.log("");

  if (formato.semEco === true) {
    console.log("  ok    o modo SEM ECO ativou (captura por processo)");
    console.log(
      "        o que o Aether toca — a voz da call — fica de fora da captura",
    );
  } else {
    console.log("  ATENCAO  caiu no loopback de DISPOSITIVO (com eco)");
    console.log(
      "        o Windows precisa ser 10 build 19041 (20H1) ou mais novo,",
    );
    console.log("        e nenhum aparelho pode ter sido escolhido a mao.");
  }

  console.log(`\nouvindo por ${SEGUNDOS}s — deixe um som tocando em OUTRO programa...`);
  let bytes = 0;
  let maior = 0;
  const ate = Date.now() + SEGUNDOS * 1000;
  while (Date.now() < ate) {
    await new Promise((r) => setTimeout(r, 200));
    const pedaco = sessao.read();
    if (pedaco && pedaco.length > 0) {
      bytes += pedaco.length;
      const p = picoFloat32(pedaco);
      if (p > maior) maior = p;
    }
  }
  sessao.stop();

  const segundosCapturados = bytes / (formato.sampleRate * formato.blockAlign);
  console.log(`\nbytes: ${bytes} (~${segundosCapturados.toFixed(2)}s de audio)`);
  console.log(`pico: ${maior.toFixed(4)}`);

  if (bytes === 0) {
    console.log("\n  FALHA  nao chegou audio nenhum — a captura nao esta entregando.");
    process.exitCode = 1;
  } else if (maior < 0.0001) {
    console.log(
      "\n  ..     chegou audio, mas em SILENCIO. Se havia som tocando em outro" +
        "\n         programa, isto e defeito; se nao havia, e o esperado.",
    );
  } else {
    console.log("\n  ok     o som de outros programas continua chegando.");
  }
}

main().catch((erro) => {
  console.error("erro:", erro);
  process.exitCode = 1;
});
