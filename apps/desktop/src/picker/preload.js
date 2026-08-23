"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * Ponte do seletor. Tres funcoes, e nada alem.
 *
 * O renderer NAO recebe `desktopCapturer`: as miniaturas ja chegam prontas do
 * processo principal. Se recebesse, esta janela poderia enumerar telas por
 * conta propria, e nao ha motivo para isso — ela so precisa desenhar o que
 * mandaram e devolver uma escolha.
 */
contextBridge.exposeInMainWorld("picker", {
  /**
   * `dispositivoAtual` e o rotulo da saida de audio padrao AGORA. O processo
   * principal usa isso para decidir se uma falha antiga ainda se aplica —
   * trocar de fone merece nova tentativa.
   */
  listSources: (dispositivoAtual) =>
    ipcRenderer.invoke("picker:sources", dispositivoAtual),
  choose: (id, withAudio) => ipcRenderer.send("picker:choose", { id, withAudio }),
  cancel: () => ipcRenderer.send("picker:cancel"),
});
