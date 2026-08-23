"use strict";

const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Registro em ARQUIVO do app de desktop.
 *
 * Por que existe: o app instalado nao tem console ligado. Tudo que
 * `console.log` escreve some — e foi exatamente por isso que o erro da captura
 * de som ficou semanas sem causa conhecida: ele acontecia, era engolido, e nao
 * restava nada para olhar depois.
 *
 * O que vai aqui: falha com CAUSA. Nao e log de tudo, e log do que alguem vai
 * querer ler quando algo nao funcionou.
 *
 * NAO gravamos dado pessoal. Nome de dispositivo de audio entra porque e o que
 * distingue "falhou no fone sem fio" de "falhou em tudo" — sem ele o registro
 * nao responde a pergunta que motivou existir.
 */

/** Teto do arquivo. Passou disso, o antigo vira `.old` e comeca um novo. */
const TETO_BYTES = 256 * 1024;

function arquivo() {
  return path.join(app.getPath("userData"), "aether.log");
}

/**
 * Uma linha de registro. Nunca lanca: log que derruba o que estava tentando
 * registrar seria pior do que nao ter log.
 */
function registrar(assunto, dados) {
  try {
    const caminho = arquivo();

    // Rotacao simples: um arquivo antigo basta para investigar.
    try {
      if (fs.statSync(caminho).size > TETO_BYTES) {
        fs.renameSync(caminho, `${caminho}.old`);
      }
    } catch {
      // Nao existe ainda, ou nao deu para medir. Segue.
    }

    const linha = `${new Date().toISOString()}  ${assunto}  ${
      dados === undefined ? "" : JSON.stringify(dados)
    }\n`;
    fs.appendFileSync(caminho, linha, "utf8");

    // Em desenvolvimento tambem no console, que e onde se esta olhando.
    if (!app.isPackaged) console.log(`[log] ${assunto}`, dados ?? "");
  } catch {
    // Disco cheio, pasta sem permissao: nao ha o que fazer, e nao ha o que
    // quebrar por causa disso.
  }
}

/** Onde o arquivo esta — para a interface poder mostrar o caminho. */
function caminhoDoLog() {
  return arquivo();
}

module.exports = { registrar, caminhoDoLog };
