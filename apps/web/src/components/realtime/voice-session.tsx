"use client";

import { useEffect, useRef } from "react";
import { useRealtimeStore, useSelfVoice } from "@/lib/stores/realtime-store";
import { useSocket } from "@/components/realtime/realtime-provider";
import {
  connectVoiceRoom,
  type VoiceRoomHandle,
} from "@/lib/voice/room";

/**
 * Liga e desliga a sessao de midia conforme voce entra e sai de canais de voz.
 *
 * Fica no layout do servidor, nao na pagina do canal: a call continua quando
 * voce navega para um canal de texto. Se vivesse na pagina, trocar de canal
 * derrubaria o audio.
 *
 * As credenciais vem do ack do voice:join — ou seja, so existem depois de a
 * permissao ter sido checada no servidor. Quando `media` e null, o servidor
 * nao tem SFU configurado: a ocupacao de canal continua funcionando e nao ha
 * audio, o que a faixa de aviso comunica.
 */
export function VoiceSession() {
  const socket = useSocket();
  const selfVoice = useSelfVoice();
  const media = useRealtimeStore((state) => state.media);
  const setVoiceError = useRealtimeStore((state) => state.setVoiceError);
  const setMediaConnected = useRealtimeStore((state) => state.setMediaConnected);
  const setScreenShares = useRealtimeStore((state) => state.setScreenShares);
  const setLocalSharing = useRealtimeStore((state) => state.setLocalSharing);
  const setShareControls = useRealtimeStore((state) => state.setShareControls);

  const channelId = selfVoice?.channelId ?? null;
  const muted = selfVoice?.selfMuted ?? false;
  const deafened = selfVoice?.selfDeafened ?? false;

  const roomRef = useRef<VoiceRoomHandle | null>(null);

  // 1. conexao com a sala — refeita quando o canal ou o token muda
  useEffect(() => {
    if (!channelId || !media || !socket) return;

    let cancelled = false;

    connectVoiceRoom({
      url: media.url,
      token: media.token,
      canPublish: media.canPublish,
      callbacks: {
        onSpeakingChange: (speaking) => {
          // O indicador continua sendo publicado pelo NOSSO gateway: a
          // bordinha precisa acender tambem para quem esta olhando um canal
          // em que nao entrou, e o SFU so conhece a propria sala.
          socket.emit("voice:speaking", speaking);
        },
        onConnectionChange: (connected) => setMediaConnected(connected),
        onScreenSharesChange: (shares) => setScreenShares(shares),
        onLocalShareEnded: () => {
          // Cobre tambem o "parar de compartilhar" da barra do navegador, que
          // nao passa pela nossa interface.
          setLocalSharing(false);
          socket.emit("voice:streaming", false);
        },
        onError: (message) => setVoiceError(message),
      },
    })
      .then((handle) => {
        if (cancelled) {
          void handle.disconnect();
          return;
        }
        roomRef.current = handle;
        setVoiceError(null);

        /**
         * Publica os comandos de tela enquanto a sessao existe. O indicador
         * para os outros passa pelo NOSSO gateway, e nao pelo SFU, porque a
         * arvore de canais precisa mostrar quem transmite para quem nem entrou
         * na sala de midia.
         */
        setShareControls({
          start: async (preset) => {
            const started = await handle.startScreenShare(preset);
            if (started) {
              setLocalSharing(true, handle.localScreenTrack());
              socket.emit("voice:streaming", true);
            }
            return started;
          },
          stop: async () => {
            await handle.stopScreenShare();
            setLocalSharing(false);
            // O aviso de "sem audio do sistema" perde o sentido assim que a
            // transmissao acaba.
            setVoiceError(null);
            socket.emit("voice:streaming", false);
          },
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "Falha ao conectar o audio";
        setVoiceError(`Audio indisponivel: ${message}`);
        setMediaConnected(false);
      });

    return () => {
      cancelled = true;
      const handle = roomRef.current;
      roomRef.current = null;
      setMediaConnected(false);
      setShareControls(null);
      setScreenShares([]);
      setLocalSharing(false);
      socket.emit("voice:streaming", false);
      void handle?.disconnect();
      // Sair da call sem apagar o indicador deixaria voce "falando" para
      // sempre na tela dos outros.
      socket.emit("voice:speaking", false);
    };
  }, [
    channelId,
    media,
    socket,
    setVoiceError,
    setMediaConnected,
    setScreenShares,
    setLocalSharing,
    setShareControls,
  ]);

  // 2. mute e deafen passam a ter efeito real sobre a midia
  useEffect(() => {
    void roomRef.current?.setMicrophoneEnabled(!muted);
  }, [muted]);

  useEffect(() => {
    roomRef.current?.setDeafened(deafened);
  }, [deafened]);

  return null;
}
