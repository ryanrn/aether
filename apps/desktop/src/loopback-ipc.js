"use strict";

const { ipcMain } = require("electron");
const log = require("./log");
const loopback = require("../native");
const { escolhaDeAudioDoSeletor } = require("./picker");

/**
 * Leva o som do sistema do processo principal ate a pagina.
 *
 * POR QUE ISTO EXISTE: o Chromium nao abre a captura de som em dispositivos
 * que se anunciam com mais de dois canais — medido no PRO X2 sem fio, que se
 * apresenta como 7.1 (8 canais) mesmo com o surround desligado. O Windows
 * entrega esse som sem reclamar; o navegador e que nao consegue pegá-lo.
 *
 * O modulo nativo captura e ja mistura para estereo. Daqui os pedacos vao
 * para a pagina, que os transforma em faixa publicavel no LiveKit.
 *
 * O ENVIO E EM LOTE, e nao a cada bloco do WASAPI: 48 kHz estereo float32 sao
 * 384 KB/s, e mandar isso em pedacinhos de 2 ms seriam centenas de mensagens
 * por segundo atravessando a ponte. A cada 20 ms o volume e o mesmo e o numero
 * de mensagens cai para 50.
 */

/** De quanto em quanto tempo esvaziamos o buffer nativo. */
const INTERVALO_MS = 20;

let sessao = null;
let timer = null;
let destino = null;

function parar() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (sessao) {
    try {
      sessao.stop();
    } catch (erro) {
      log.registrar("loopback.stop.falhou", { erro: erro.message });
    }
    sessao = null;
  }
  destino = null;
}

function instalarLoopback() {
  /**
   * Registra a disponibilidade LOGO NO BOOT, e nao so quando alguem tenta
   * compartilhar.
   *
   * O `index.js` degrada em silencio quando o binario nao carrega — o que e o
   * comportamento certo para nao derrubar o app, e o comportamento errado
   * para descobrir o problema. Sem esta linha, um app empacotado sem o `.node`
   * pareceria normal ate a primeira transmissao sem som, e ninguem saberia
   * por que.
   */
  log.registrar("loopback.disponivel", {
    sim: loopback.disponivel(),
    motivo: loopback.indisponivelPorque(),
  });

  /**
   * Disponibilidade e um FATO, nao uma promessa. Se o binario nativo nao
   * carregou (arquitetura errada, DLL faltando, ou nao e Windows), quem
   * pergunta recebe `false` e o motivo — em vez de descobrir com uma excecao
   * no meio de uma chamada.
   */
  ipcMain.handle("desktop:loopback-available", () => ({
    disponivel: loopback.disponivel(),
    motivo: loopback.indisponivelPorque(),
  }));

  /**
   * O que a pessoa respondeu no seletor sobre levar o som. A pergunta e feita
   * la; quem captura e o renderer.
   */
  ipcMain.handle("desktop:share-audio-choice", () => escolhaDeAudioDoSeletor());

  ipcMain.handle("desktop:loopback-devices", () => {
    if (!loopback.disponivel()) return [];
    try {
      return loopback.listarSaidas();
    } catch (erro) {
      log.registrar("loopback.listar.falhou", { erro: erro.message });
      return [];
    }
  });

  ipcMain.handle("desktop:loopback-start", (evento, deviceId) => {
    parar();

    if (!loopback.disponivel()) {
      return { ok: false, erro: loopback.indisponivelPorque() };
    }

    try {
      sessao = loopback.abrir();
      sessao.start(typeof deviceId === "string" ? deviceId : undefined);
    } catch (erro) {
      /**
       * O erro do WASAPI vai INTEIRO para o log, com o HRESULT. Foi a falta
       * disso que deixou o problema original semanas sem causa conhecida.
       */
      log.registrar("loopback.start.falhou", { deviceId, erro: erro.message });
      sessao = null;
      return { ok: false, erro: erro.message };
    }

    const formato = sessao.format();
    log.registrar("loopback.start", {
      canaisDoAparelho: formato.origem.channels,
      misturado: formato.origem.downmix,
      taxa: formato.sampleRate,
    });

    destino = evento.sender;
    timer = setInterval(() => {
      if (!sessao || !destino || destino.isDestroyed()) {
        parar();
        return;
      }
      let pedaco;
      try {
        pedaco = sessao.read();
      } catch (erro) {
        log.registrar("loopback.read.falhou", { erro: erro.message });
        parar();
        return;
      }
      if (pedaco.length > 0) destino.send("desktop:loopback-data", pedaco);
    }, INTERVALO_MS);

    return { ok: true, formato };
  });

  ipcMain.handle("desktop:loopback-stop", () => {
    parar();
    return { ok: true };
  });
}

/** Chamado no encerramento do app, para nao deixar thread de captura viva. */
function encerrarLoopback() {
  parar();
}

module.exports = { instalarLoopback, encerrarLoopback };
