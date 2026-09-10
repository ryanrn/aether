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
   * Deep link `aether://invite/<codigo>`.
   *
   * O processo principal ja resolveu o codigo para um caminho interno
   * (`/invite/<codigo>`); a pagina so navega para la (client-side, sem
   * recarregar). `deepLinkPendente` cobre o caso de o evento ter chegado
   * antes de o ouvinte existir — ou de o app ter aberto do zero pelo link.
   * `deepLinkAck` avisa o main que a pagina cuidou, cancelando o fallback.
   */
  deepLink: {
    pendente: () => ipcRenderer.invoke("desktop:deep-link-pendente"),
    confirmar: () => ipcRenderer.send("desktop:deep-link-ack"),
    aoReceber: (callback) => {
      const ouvinte = (_evento, caminho) => callback(caminho);
      ipcRenderer.on("desktop:deep-link", ouvinte);
      return () => ipcRenderer.removeListener("desktop:deep-link", ouvinte);
    },
  },

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
    iniciar: (deviceId) =>
      ipcRenderer.invoke("desktop:loopback-start", deviceId),
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
      return () =>
        ipcRenderer.removeListener("desktop:atualizacao-pronta", handler);
    },
  },

  /**
   * OAuth de uma conexao numa janela dedicada do processo principal.
   *
   * A pagina so consegue PEDIR que abra, passando o CAMINHO da rota de
   * conectar (`/api/spotify/connect`, `/api/conexoes/twitch/connect`, ...). A
   * janela, a sessao compartilhada e o fechamento automatico ficam no main.
   * Resolve quando o fluxo termina — a aba de Conexoes re-checa o estado ai.
   */
  conexoes: {
    conectar: (caminho) =>
      ipcRenderer.invoke("desktop:conexao-connect", caminho),
  },

  /** @deprecated use `conexoes.conectar("/api/spotify/connect")` */
  spotify: {
    conectar: () =>
      ipcRenderer.invoke("desktop:conexao-connect", "/api/spotify/connect"),
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

    /**
     * Entrega ao processo principal o catalogo aprovado pela equipe.
     *
     * A pagina busca e repassa porque a SESSAO vive aqui: dar ao processo
     * principal uma credencial propria seria criar um segundo lugar com
     * segredo para resolver um problema que a pagina ja resolve.
     */
    definirCatalogo: (lista) =>
      ipcRenderer.invoke("desktop:jogos-catalogo-set", lista),

    /**
     * Os processos que a pessoa poderia sugerir como jogo.
     *
     * A UNICA porta pela qual nomes de processo chegam a pagina, e ela so
     * responde quando a deteccao esta ligada. Devolve NOMES, jamais caminhos —
     * caminho carrega o nome de usuario do Windows, que e exatamente o dado
     * que a biblioteca foi desenhada para nunca tocar.
     */
    listarCandidatos: () => ipcRenderer.invoke("desktop:jogos-candidatos"),
  },
});
