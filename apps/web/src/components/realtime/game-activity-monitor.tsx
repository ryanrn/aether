"use client";

import { useEffect } from "react";
import { useSocket } from "@/components/realtime/realtime-provider";
import {
  canDetectGames,
  currentGame,
  onGameChange,
} from "@/lib/desktop/game-activity";

/**
 * Leva o jogo detectado pelo app de desktop ate o gateway.
 *
 * Nao desenha nada — mora na RAIZ do app (`RealtimeRoot`). Ja morou no layout
 * do servidor, e era um bug: ir para Amigos ou para uma conversa desmontava o
 * monitor, e a limpeza abaixo dizia a todos que a pessoa tinha parado de jogar.
 * Trocar de servidor tambem zerava o tempo de jogo.
 *
 * Quem detecta e o processo principal do Electron; aqui so repassamos o nome.
 * No navegador `canDetectGames()` e falso e este componente nao faz nada.
 */
export function GameActivityMonitor() {
  const socket = useSocket();

  useEffect(() => {
    if (!socket || !canDetectGames()) return;

    /**
     * Escutamos SEMPRE, sem perguntar antes se a deteccao esta ligada.
     *
     * Ja foi ao contrario, e era um bug: este efeito roda uma vez, quando o
     * socket conecta. Com a deteccao desligada naquele instante — que e o
     * padrao — ele saia sem se inscrever. Ligar a chave depois punha o
     * processo principal para vigiar e emitir, mas nao havia ninguem aqui para
     * repassar, e o jogo simplesmente nunca aparecia ate reabrir o app.
     *
     * Nao enfraquece nada: quem le processos e o processo principal, e ele nao
     * emite com a deteccao desligada. Um ouvinte parado nao le coisa alguma —
     * a tranca que importa e a de la, nao esta.
     */
    const desinscrever = onGameChange((jogo) => {
      socket.emit(
        "presence:game",
        jogo ? { name: jogo.nome, icon: jogo.icone } : null,
      );
    });

    /**
     * E perguntamos o que JA foi detectado. O vigia avisa so em mudanca, entao
     * quem carrega a pagina depois de o jogo ter aberto nunca receberia o
     * aviso — o jogo so apareceria se a pessoa fechasse e abrisse o jogo.
     */
    let cancelado = false;
    function enviarOAtual() {
      void currentGame().then((jogo) => {
        if (!cancelado && jogo) {
          socket?.emit("presence:game", { name: jogo.nome, icon: jogo.icone });
        }
      });
    }
    enviarOAtual();

    /**
     * E de novo a cada reconexao. O gateway apaga o jogo quando cai o ultimo
     * socket, e o vigia nao avisa nada porque o jogo nao mudou: sem isto, uma
     * queda de rede deixava a pessoa "sem jogo" ate fechar o jogo.
     */
    socket.on("connect", enviarOAtual);

    return () => {
      cancelado = true;
      socket.off("connect", enviarOAtual);
      desinscrever();
      /**
       * Sair limpa o jogo para os outros. Sem isto, fechar a aba deixaria
       * "jogando Hollow Knight" congelado na tela de todo mundo ate o gateway
       * derrubar a conexao.
       */
      socket.emit("presence:game", null);
    };
  }, [socket]);

  return null;
}
