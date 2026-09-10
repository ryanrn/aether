"use strict";

const { app } = require("electron");
const path = require("node:path");
const { registrar } = require("./log");

/**
 * Links de convite pelo protocolo `aether://`.
 *
 * `aether://invite/<codigo>` -> a janela navega para `/invite/<codigo>` no site
 * remoto, que faz TODO o trabalho: valida o convite, checa sessao, manda para
 * o login se preciso, aceita e abre o servidor. A casca so aponta a janela
 * para o lugar certo — nunca confia no codigo, isso e no backend.
 *
 * So `invite` e aceito, e so com codigo no formato certo. Qualquer outra
 * coisa e ignorada: o protocolo nao pode virar "navegue para qualquer path".
 */

/** Mesmo formato do `inviteCodeSchema` do @aether/shared: [a-z0-9], 6-24. */
const CODIGO = /^[a-z0-9]{6,24}$/i;

/**
 * Extrai o caminho interno de uma URL `aether://…`, ou `null` se nao for um
 * deep link que entendemos.
 *
 * Aceita `aether://invite/<codigo>` e tambem `aether://invite/<codigo>/`
 * (barra final que alguns clientes acrescentam) e querystring (ignorada).
 */
function caminhoDoDeepLink(url) {
  if (typeof url !== "string" || !url.toLowerCase().startsWith("aether://")) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // `aether://invite/CODE` -> host = "invite", pathname = "/CODE".
  const acao = parsed.host.toLowerCase();
  const resto = parsed.pathname.replace(/^\/+|\/+$/g, "");
  if (acao === "invite" && CODIGO.test(resto)) {
    return `/invite/${resto.toLowerCase()}`;
  }
  return null;
}

/**
 * Acha um `aether://…` numa lista de argumentos de processo (o Windows passa
 * a URL como um dos argv quando o app e aberto pelo protocolo).
 */
function deepLinkNosArgs(argv) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv) {
    const caminho = caminhoDoDeepLink(arg);
    if (caminho) return caminho;
  }
  return null;
}

/**
 * Registra o app como dono do esquema `aether://`.
 *
 * Em dev (`electron .`) o executavel e o proprio electron, entao passamos o
 * caminho do projeto como argumento — sem isso o Windows registraria
 * `electron.exe` sozinho e o relançamento abriria o Electron vazio.
 */
function registrarProtocolo() {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("aether", process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    } else {
      app.setAsDefaultProtocolClient("aether");
    }
    registrar("deep-link:protocolo-registrado", {});
  } catch (erro) {
    registrar("deep-link:registro-falhou", { erro: String(erro) });
  }
}

module.exports = {
  caminhoDoDeepLink,
  deepLinkNosArgs,
  registrarProtocolo,
};
