"use strict";

/**
 * Testa a captura do som do sistema, dispositivo por dispositivo.
 *
 * A pergunta que este script responde e uma so: o WASAPI loopback abre nas
 * saidas desta maquina — inclusive naquela onde o Chromium falha com
 * `NotReadableError: Could not start audio source`?
 *
 * IMPORTANTE: deixe algum som TOCANDO (video, musica) na saida que esta sendo
 * testada. Sem som, o loopback abre e entrega silencio — o que e sucesso da
 * captura, mas nao prova que o audio chega. O script distingue os dois casos.
 *
 * Uso:
 *   node apps/desktop/native/testar.js
 */
const loopback = require("./index");

const SEGUNDOS = 3;

function pico(buffer, formato) {
  if (buffer.length === 0) return 0;
  let maior = 0;
  if (formato.isFloat && formato.bitsPerSample === 32) {
    for (let i = 0; i + 4 <= buffer.length; i += 4) {
      const v = Math.abs(buffer.readFloatLE(i));
      if (v > maior) maior = v;
    }
    return maior;
  }
  if (formato.bitsPerSample === 16) {
    for (let i = 0; i + 2 <= buffer.length; i += 2) {
      const v = Math.abs(buffer.readInt16LE(i)) / 32768;
      if (v > maior) maior = v;
    }
    return maior;
  }
  return -1; // formato que este teste nao sabe medir
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function testar(dispositivo) {
  const rotulo = `${dispositivo.name}${dispositivo.isDefault ? "  [PADRAO]" : ""}`;
  console.log(`\n${rotulo}`);

  const sessao = loopback.abrir();
  try {
    sessao.start(dispositivo.id);
  } catch (erro) {
    console.log(`  NAO ABRIU — ${erro.message}`);
    return { rotulo, abriu: false };
  }

  const f = sessao.format();
  console.log(
    `  formato: ${f.sampleRate} Hz, ${f.channels} canais, ` +
      `${f.bitsPerSample} bits ${f.isFloat ? "float" : "int"}, ` +
      `blockAlign ${f.blockAlign}`,
  );

  let total = 0;
  let maiorPico = 0;
  for (let i = 0; i < SEGUNDOS * 10; i++) {
    await dormir(100);
    let pedaco;
    try {
      pedaco = sessao.read();
    } catch (erro) {
      console.log(`  ERRO durante a captura — ${erro.message}`);
      sessao.stop();
      return { rotulo, abriu: true, erro: erro.message };
    }
    total += pedaco.length;
    const p = pico(pedaco, f);
    if (p > maiorPico) maiorPico = p;
  }
  sessao.stop();

  const esperado = f.sampleRate * f.blockAlign * SEGUNDOS;
  const proporcao = esperado > 0 ? total / esperado : 0;

  console.log(
    `  recebido: ${(total / 1024).toFixed(0)} KB em ${SEGUNDOS}s ` +
      `(${(proporcao * 100).toFixed(0)}% do esperado)`,
  );
  console.log(
    maiorPico > 0.0005
      ? `  SOM DE VERDADE — pico ${maiorPico.toFixed(4)}`
      : `  abriu, porem SILENCIO (nada tocando nesta saida?)`,
  );

  return { rotulo, abriu: true, bytes: total, pico: maiorPico, proporcao };
}

async function main() {
  console.log("=================================================");
  console.log(" Captura do som do sistema — WASAPI loopback");
  console.log("=================================================");

  if (!loopback.disponivel()) {
    console.log(`INDISPONIVEL: ${loopback.indisponivelPorque()}`);
    process.exit(1);
  }

  const saidas = loopback.listarSaidas();
  console.log(`${saidas.length} saida(s) ativa(s).`);
  console.log("\nDeixe som TOCANDO na saida que voce quer testar.");

  const resultados = [];
  for (const saida of saidas) {
    resultados.push(await testar(saida));
  }

  console.log("\n-------------------------------------------------");
  const abriram = resultados.filter((r) => r.abriu && !r.erro);
  const comSom = abriram.filter((r) => r.pico > 0.0005);

  console.log(`abriram loopback : ${abriram.length} de ${resultados.length}`);
  console.log(`com som de fato  : ${comSom.length}`);
  for (const r of comSom) console.log(`  * ${r.rotulo}`);

  const falharam = resultados.filter((r) => !r.abriu);
  if (falharam.length > 0) {
    console.log("\nNAO abriram:");
    for (const r of falharam) console.log(`  * ${r.rotulo}`);
  }
  console.log("-------------------------------------------------\n");
}

main().catch((erro) => {
  console.error("erro:", erro);
  process.exit(1);
});
