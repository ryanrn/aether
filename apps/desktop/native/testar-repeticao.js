"use strict";

/**
 * A exclusao sobrevive a VARIOS compartilhamentos na mesma sessao?
 *
 * POR QUE ESTE TESTE EXISTE: a ativacao por processo nao aceita duas ao mesmo
 * tempo — a segunda devolve `0x8000FFFF`. O app abre e fecha uma captura a
 * cada compartilhamento, sempre no mesmo processo, que fica aberto o dia
 * inteiro. Se alguma sobra nao for liberada, a captura seguinte perde a
 * exclusao e volta a mandar a call de volta para a call.
 *
 * Um teste que abre UMA captura e fecha nunca veria isso. Este abre e fecha
 * varias, como um dia de uso, e falha se `semEco` cair em qualquer uma.
 *
 * Uso:
 *   npx electron apps/desktop/native/testar-repeticao.js
 */
const { app } = require("electron");
const loopback = require("./index");

const RODADAS = 6;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  if (!loopback.disponivel()) {
    console.log("NAO CARREGOU:", loopback.indisponivelPorque());
    app.exit(1);
    return;
  }

  const resultados = [];

  for (let i = 1; i <= RODADAS; i++) {
    const sessao = loopback.abrir();
    let semEco = null;
    let erro = null;
    try {
      sessao.start();
      semEco = sessao.format().semEco === true;
      // Le um pouco, como o app faz, antes de fechar.
      await dormir(400);
      sessao.read();
    } catch (e) {
      erro = e.message;
    }
    try {
      sessao.stop();
    } catch {
      /* ja parada */
    }
    resultados.push({ rodada: i, semEco, erro });
    console.log(
      `rodada ${i}: semEco=${semEco}` + (erro ? `  ERRO: ${erro}` : ""),
    );
    await dormir(250);
  }

  const falhas = resultados.filter((r) => r.semEco !== true);
  console.log("");
  if (falhas.length === 0) {
    console.log(`  ok     ${RODADAS} capturas seguidas, todas com exclusao.`);
    console.log("         abrir e fechar nao deixa sobra que derrube a proxima.");
  } else {
    console.log(`  FALHA  ${falhas.length} de ${RODADAS} perderam a exclusao.`);
    console.log("         a partir dai o som da tela levaria a call junto —");
    console.log("         e o eco voltaria no meio de um dia de uso.");
    for (const f of falhas) {
      console.log(`         rodada ${f.rodada}: ${f.erro ?? "semEco falso"}`);
    }
    process.exitCode = 1;
  }

  app.exit(falhas.length === 0 ? 0 : 1);
});
