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
  listSources: () => ipcRenderer.invoke("picker:sources"),
  choose: (id, withAudio) => ipcRenderer.send("picker:choose", { id, withAudio }),
  cancel: () => ipcRenderer.send("picker:cancel"),
});
