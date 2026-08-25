"use strict";

/**
 * Captura do som do sistema por WASAPI loopback.
 *
 * So existe no Windows. Em qualquer outro sistema, `disponivel()` responde
 * false e nada mais aqui deve ser chamado — quem usa decide o que fazer com
 * isso em vez de receber uma excecao de um `require` que falhou.
 */

let nativo = null;
let motivo = null;

if (process.platform === "win32") {
  try {
    nativo = require("./build/Release/aether_loopback.node");
  } catch (erro) {
    motivo = erro.message;
  }
} else {
  motivo = `sem suporte em ${process.platform}`;
}

function disponivel() {
  return nativo !== null;
}

/** Por que nao esta disponivel — para o log dizer algo util. */
function indisponivelPorque() {
  return motivo;
}

/** As saidas de audio ativas: `[{ id, name, isDefault }]`. */
function listarSaidas() {
  if (!nativo) throw new Error(`loopback indisponivel: ${motivo}`);
  return nativo.listDevices();
}

/** Uma sessao de captura. `deviceId` vazio usa a saida padrao do Windows. */
function abrir() {
  if (!nativo) throw new Error(`loopback indisponivel: ${motivo}`);
  return new nativo.Loopback();
}

module.exports = { disponivel, indisponivelPorque, listarSaidas, abrir };
