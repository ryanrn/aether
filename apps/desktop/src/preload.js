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
  /**
   * `detalhes` e `{ erro, dispositivo }` — o nome da excecao e a saida de
   * audio padrao no momento da falha.
   *
   * Antes isto ia VAZIO, e essa era a razao de "nao funciona" nunca virar uma
   * causa: o app sabia exatamente qual erro tinha sido e jogava fora.
   */
  reportAudioCaptureFailed: (detalhes) =>
    ipcRenderer.send("desktop:audio-capture-failed", detalhes ?? null),

  /**
   * Som do sistema para o compartilhamento de tela.
   *
   * Existe porque o Chromium nao abre a captura em aparelhos que se anunciam
   * com mais de dois canais — o PRO X2 sem fio se apresenta como 7.1. Aqui o
   * som vem do modulo nativo, ja misturado para estereo.
   *
   * O que atravessa e PCM da SAIDA DE AUDIO, nada mais. Nao ha acesso a
   * dispositivo, a arquivo nem a lista de processos por este caminho.
   */
  loopback: {
    disponivel: () => ipcRenderer.invoke("desktop:loopback-available"),
    saidas: () => ipcRenderer.invoke("desktop:loopback-devices"),
    iniciar: (deviceId) => ipcRenderer.invoke("desktop:loopback-start", deviceId),
    /** o que foi respondido no seletor sobre levar o som do sistema */
    escolhaDoSeletor: () => ipcRenderer.invoke("desktop:share-audio-choice"),
    parar: () => ipcRenderer.invoke("desktop:loopback-stop"),
    /** devolve a funcao que cancela a inscricao */
    aoReceber: (callback) => {
      const ouvinte = (_evento, pedaco) => callback(pedaco);
      ipcRenderer.on("desktop:loopback-data", ouvinte);
      return () => ipcRenderer.removeListener("desktop:loopback-data", ouvinte);
    },
  },

  /**
   * Deteccao de jogo.
   *
   * A pagina so consegue tres coisas: perguntar se esta ligada, ligar/desligar
   * e ouvir o NOME do jogo. Ela nunca alcanca a lista de processos — quem le e
   * casa isso e o processo principal, e o que atravessa esta ponte ja e o
   * resultado.
   */
  /**
   * Abrir junto com o Windows. A preferencia mora no SISTEMA, nao aqui — por
   * isso `isEnabled` pergunta a cada vez em vez de guardar um valor.
   */
  iniciarComWindows: {
    isEnabled: () => ipcRenderer.invoke("desktop:iniciar-com-windows-get"),
    setEnabled: (ligar) =>
      ipcRenderer.invoke("desktop:iniciar-com-windows-set", ligar),
  },

  /**
   * Atualizacao do app. `pendente()` existe porque a pagina pode carregar
   * DEPOIS de a versao ter sido baixada — o evento acontece uma vez, e quem
   * chega atrasado precisa de alguem a quem perguntar.
   */
  atualizacao: {
    pendente: () => ipcRenderer.invoke("desktop:atualizacao-pendente"),
    instalar: () => ipcRenderer.invoke("desktop:atualizacao-instalar"),
    estado: () => ipcRenderer.invoke("desktop:atualizacao-estado"),
    verificar: () => ipcRenderer.invoke("desktop:atualizacao-verificar"),
    aoMudarEstado: (callback) => {
      const handler = (_evento, estado) => callback(estado);
      ipcRenderer.on("desktop:atualizacao-estado", handler);
      return () =>
        ipcRenderer.removeListener("desktop:atualizacao-estado", handler);
    },
    aoFicarPronta: (callback) => {
      const handler = (_evento, versao) => callback(versao);
      ipcRenderer.on("desktop:atualizacao-pronta", handler);
      return () => ipcRenderer.removeListener("desktop:atualizacao-pronta", handler);
    },
  },

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
