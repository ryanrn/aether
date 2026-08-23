"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * Ponte entre o app carregado e o processo principal.
 *
 * Alem do sinal de "rodando no desktop", expoe um aviso de mao unica: a
 * pagina chama `reportAudioCaptureFailed` quando `getDisplayMedia` rejeita
 * por causa do SOM (video teria funcionado). O main usa isso para desligar a
 * preferencia de audio do seletor — sem isto, numa maquina onde o loopback
 * falha (verificado com fone/dongle sem fio), toda tentativa pediria som de
 * novo e falharia de novo, para sempre.
 *
 * Nada alem disso e exposto de proposito. Cada funcao publicada aqui vira
 * superficie que o conteudo REMOTO pode chamar; a regra e so publicar o que
 * o app realmente precisa, quando precisar.
 */
contextBridge.exposeInMainWorld("aetherDesktop", {
  version: process.env.npm_package_version ?? "0.1.0",
  platform: process.platform,
  reportAudioCaptureFailed: () => ipcRenderer.send("desktop:audio-capture-failed"),

  /**
   * Deteccao de jogo.
   *
   * A pagina so consegue tres coisas: perguntar se esta ligada, ligar/desligar
   * e ouvir o NOME do jogo. Ela nunca alcanca a lista de processos — quem le e
   * casa isso e o processo principal, e o que atravessa esta ponte ja e o
   * resultado.
   */
  gameDetection: {
    isEnabled: () => ipcRenderer.invoke("desktop:game-detection-get"),
    /** o jogo ja detectado, para quem acabou de carregar */
    getCurrent: () => ipcRenderer.invoke("desktop:game-current"),
    setEnabled: (ligada) =>
      ipcRenderer.invoke("desktop:game-detection-set", ligada === true),
    /** Devolve a funcao que cancela a inscricao — sem ela, trocar de tela vaza. */
    onChange: (callback) => {
      // `jogo` e `{ nome, icone }` ou null.
      const ouvinte = (_evento, jogo) => callback(jogo ?? null);
      ipcRenderer.on("desktop:game-changed", ouvinte);
      return () => ipcRenderer.removeListener("desktop:game-changed", ouvinte);
    },
  },
});
