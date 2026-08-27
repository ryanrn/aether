"use strict";

/**
 * Qual e o formato REAL da saida de audio desta maquina?
 *
 * A pergunta importa porque a captura por processo usa um formato FIXO
 * (48 kHz, estereo, float32) — o dispositivo virtual nao responde
 * `GetMixFormat`. Se o endpoint usar outro formato e nao pedirmos conversao,
 * o `Initialize` recusa, a exclusao falha, e o app cai no loopback de
 * dispositivo — que devolve a call inteira para a call.
 *
 * Para ver o formato do endpoint precisamos do caminho de DISPOSITIVO, que so
 * e escolhido quando um aparelho e pedido pelo id.
 *
 * Uso:
 *   npx electron apps/desktop/native/testar-formato.js
 */
const { app } = require("electron");
const loopback = require("./index");

app.whenReady().then(() => {
  if (!loopback.disponivel()) {
    console.log("NAO CARREGOU:", loopback.indisponivelPorque());
    app.exit(1);
    return;
  }

  const saidas = loopback.listarSaidas();
  console.log("saidas de audio:");
  for (const s of saidas) {
    console.log(`  ${s.isDefault ? "*" : " "} ${s.name}`);
  }

  const padrao = saidas.find((s) => s.isDefault) ?? saidas[0];
  if (!padrao) {
    console.log("\nnenhuma saida ativa");
    app.exit(1);
    return;
  }

  console.log(`\nabrindo pelo ID (caminho de dispositivo): ${padrao.name}`);
  const sessao = loopback.abrir();
  try {
    sessao.start(padrao.id);
    const f = sessao.format();
    console.log("formato do ENDPOINT:", JSON.stringify(f.origem));
    console.log(`  taxa: ${f.sampleRate} Hz`);
    console.log(`  canais do aparelho: ${f.origem.channels}`);
    console.log(`  precisa misturar para estereo: ${f.origem.downmix}`);

    const combina = f.sampleRate === 48000 && f.origem.channels === 2;
    console.log("");
    if (combina) {
      console.log("  ..  o endpoint JA e 48 kHz estereo.");
      console.log("      neste aparelho a captura por processo funcionaria");
      console.log("      mesmo sem pedir conversao de formato — foi por isso");
      console.log("      que o defeito passou pelo teste.");
    } else {
      console.log("  !!  o endpoint NAO e 48 kHz estereo.");
      console.log("      sem AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM o Initialize");
      console.log("      da captura por processo recusaria este aparelho, e o");
      console.log("      app cairia no loopback de dispositivo — com o eco.");
    }
    sessao.stop();
  } catch (erro) {
    console.log("falhou:", erro.message);
  }

  app.exit(0);
});
