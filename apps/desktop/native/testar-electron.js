"use strict";

/**
 * O mesmo teste, porem DENTRO do Electron.
 *
 * Existe separado do `testar.js` porque o binario e outro: o `.node` compilado
 * para o Node nao carrega no Electron e vice-versa — sao ABIs diferentes.
 * Rodar so no Node provaria que o C++ funciona, e nao que funciona no lugar
 * onde vai viver.
 *
 * Uso (depois de compilar com --target da versao do Electron):
 *   npx electron apps/desktop/native/testar-electron.js
 */
const { app } = require("electron");
const loopback = require("./index");

const SEGUNDOS = 3;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function pico(buffer) {
  let maior = 0;
  for (let i = 0; i + 4 <= buffer.length; i += 4) {
    const v = Math.abs(buffer.readFloatLE(i));
    if (v > maior) maior = v;
  }
  return maior;
}

app.whenReady().then(async () => {
  console.log("\n=================================================");
  console.log(" Loopback DENTRO do Electron");
  console.log("=================================================");
  console.log(`electron ${process.versions.electron} | node ${process.versions.node}`);
  console.log(`modulo ABI ${process.versions.modules}`);

  if (!loopback.disponivel()) {
    console.log(`\nNAO CARREGOU: ${loopback.indisponivelPorque()}`);
    app.exit(1);
    return;
  }
  console.log("\no modulo nativo CARREGOU no Electron.");

  const saidas = loopback.listarSaidas();
  const padrao = saidas.find((s) => s.isDefault) ?? saidas[0];
  if (!padrao) {
    console.log("nenhuma saida de audio ativa.");
    app.exit(1);
    return;
  }

  console.log(`\ncapturando de: ${padrao.name}`);
  console.log("(deixe som tocando nesta saida)");

  const sessao = loopback.abrir();
  try {
    sessao.start(padrao.id);
  } catch (erro) {
    console.log(`NAO ABRIU — ${erro.message}`);
    app.exit(1);
    return;
  }

  const f = sessao.format();
  console.log(
    `\nsaida da captura: ${f.sampleRate} Hz, ${f.channels} canais, ` +
      `${f.bitsPerSample} bits ${f.isFloat ? "float" : "int"}`,
  );
  console.log(
    `origem do aparelho: ${f.origem.channels} canais, ` +
      `blockAlign ${f.origem.blockAlign}, ` +
      `mascara 0x${f.origem.channelMask.toString(16)}` +
      `${f.origem.downmix ? "  -> MISTURADO PARA ESTEREO" : ""}`,
  );

  let total = 0;
  let maior = 0;
  for (let i = 0; i < SEGUNDOS * 10; i++) {
    await dormir(100);
    const pedaco = sessao.read();
    total += pedaco.length;
    const p = pico(pedaco);
    if (p > maior) maior = p;
  }

  /**
   * Parar NAO pode derrubar o processo. Era o defeito fatal do pacote que
   * auditamos (`std::exit(0)` no cleanup); a linha seguinte a esta so aparece
   * no console se o nosso `stop()` se comportar.
   */
  sessao.stop();
  console.log("\nstop() executou e o processo continua vivo.");

  const esperado = f.sampleRate * 2 * 4 * SEGUNDOS;
  console.log(
    `recebido: ${(total / 1024).toFixed(0)} KB em ${SEGUNDOS}s ` +
      `(${((total / esperado) * 100).toFixed(0)}% do esperado)`,
  );
  console.log(
    maior > 0.0005
      ? `SOM DE VERDADE — pico ${maior.toFixed(4)}`
      : "abriu, porem silencio (nada tocando?)",
  );

  // Uma segunda sessao, para provar que da para parar e recomecar.
  const outra = loopback.abrir();
  outra.start(padrao.id);
  await dormir(300);
  const segundo = outra.read();
  outra.stop();
  console.log(
    `segunda sessao apos stop: ${segundo.length > 0 ? "OK" : "sem dados"} ` +
      `(${segundo.length} bytes)`,
  );

  console.log("-------------------------------------------------\n");
  app.exit(0);
});

app.on("window-all-closed", () => undefined);
