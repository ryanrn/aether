"use client";

import { useCallback } from "react";
import {
  useSocket,
  type TypedSocket,
} from "@/components/realtime/realtime-provider";
import { useRealtimeStore, useSelfVoice } from "@/lib/stores/realtime-store";
import { encerrarChamadaDm } from "@/lib/voice/use-chamada-dm";

/**
 * Sai da voz de servidor, se estiver nela. Funcao solta (e nao so o `sair` do
 * hook) porque a chamada direta tambem precisa: as duas sao salas diferentes
 * do SFU, e estar nas duas ao mesmo tempo seria ouvir duas conversas
 * misturadas e falar nas duas.
 */
export function sairDaVozDeServidor(socket: TypedSocket): void {
  const estado = useRealtimeStore.getState();
  if (!estado.voiceIntent && !estado.selfVoice?.channelId) return;
  // A intencao acaba ANTES do round-trip: quando o `voice:update` de saida
  // voltar, `updateVoice` ja acha `voiceIntent` nulo e derruba a call de
  // verdade, em vez de tratar como eco.
  estado.setVoiceIntent(null);
  socket.emit("voice:leave");
  estado.setMedia(null);
}

/**
 * Entrar e sair de canal de voz, num lugar so.
 *
 * Existe porque DOIS lugares agora conectam: o botao dentro do canal e o
 * proprio clique no canal na barra lateral. Duas copias do mesmo `voice:join`
 * divergiriam — e o que se perde numa delas nao e cosmetico: o `ack` e quem
 * traz as CREDENCIAIS DE MIDIA, que so existem depois de o servidor checar a
 * permissao. Esquecer de guardar o `media` numa das copias daria uma pessoa
 * ocupando o canal na tela de todo mundo, sem audio nenhum.
 */
export function useEntrarNaVoz() {
  const socket = useSocket();
  const selfVoice = useSelfVoice();
  const setMedia = useRealtimeStore((estado) => estado.setMedia);
  const setVoiceError = useRealtimeStore((estado) => estado.setVoiceError);
  const setVoiceIntent = useRealtimeStore((estado) => estado.setVoiceIntent);

  const canalAtual = selfVoice?.channelId ?? null;

  /**
   * Entra no canal. Devolve `false` quando nem tentou — sem socket, ou por ja
   * estar ali.
   *
   * Estar no canal e um NAO-EVENTO de proposito: clicar de novo no canal em
   * que voce ja esta nao pode desconectar. Sair e uma acao deliberada, e um
   * clique repetido costuma ser engano ou navegacao.
   */
  const entrar = useCallback(
    (channelId: string) => {
      if (!socket) return false;
      if (canalAtual === channelId) return false;

      // Voz de servidor e chamada direta se excluem — ver `sairDaVozDeServidor`.
      encerrarChamadaDm(socket);

      /**
       * A intencao e gravada JA, antes do ack: se a rede cair no meio do
       * aperto de mao, o `RealtimeProvider` ainda tem o que reemitir quando o
       * socket voltar. Um ack de recusa desfaz logo abaixo.
       */
      setVoiceIntent(channelId);

      socket.emit("voice:join", { channelId }, (resultado) => {
        if (!resultado.ok) {
          /**
           * O gateway recusa por canal cheio ou falta de CONNECT. A ocupacao
           * na tela vem do `voice:update`; o ack existe para poder recusar e
           * para entregar as credenciais.
           */
          setVoiceIntent(null);
          setVoiceError(resultado.error);
          return;
        }
        setVoiceError(null);
        setMedia(resultado.media);
      });
      return true;
    },
    [socket, canalAtual, setMedia, setVoiceError, setVoiceIntent],
  );

  const sair = useCallback(() => {
    if (!socket) return;
    sairDaVozDeServidor(socket);
  }, [socket]);

  return { entrar, sair, canalAtual };
}
