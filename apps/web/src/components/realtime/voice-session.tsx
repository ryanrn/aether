"use client";

import { useEffect, useRef } from "react";
import type { MediaGrant } from "@aether/shared";
import { useRealtimeStore, useSelfVoice } from "@/lib/stores/realtime-store";
import { useSocket } from "@/components/realtime/realtime-provider";
import { connectVoiceRoom, type VoiceRoomHandle } from "@/lib/voice/room";

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
  const setMediaConnected = useRealtimeStore(
    (state) => state.setMediaConnected,
  );
  const setScreenShares = useRealtimeStore((state) => state.setScreenShares);
  const setCameras = useRealtimeStore((state) => state.setCameras);
  const setLocalSharing = useRealtimeStore((state) => state.setLocalSharing);
  const setSharePreset = useRealtimeStore((state) => state.setSharePreset);
  const setRoomControls = useRealtimeStore((state) => state.setRoomControls);

  const channelId = selfVoice?.channelId ?? null;
  /**
   * Moderacao soma ao proprio controle, nunca substitui.
   *
   * O mudo do servidor ja e imposto no SFU, entao desligar o microfone aqui e
   * redundancia barata — mas o ENSURDECER do servidor so existe no cliente:
   * nao ha como o SFU impedir alguem de ouvir sem tambem cortar o video. Esta
   * limitacao esta registrada no README.
   */
  const muted =
    (selfVoice?.selfMuted ?? false) || (selfVoice?.serverMuted ?? false);
  const deafened =
    (selfVoice?.selfDeafened ?? false) || (selfVoice?.serverDeafened ?? false);

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
        onAudioLevels: (levels) =>
          useRealtimeStore.getState().setVoiceLevels(levels),
        onConnectionChange: (connected) => setMediaConnected(connected),
        onScreenSharesChange: (shares) => setScreenShares(shares),
        onCamerasChange: (cameras) => setCameras(cameras),
        onLocalShareEnded: () => {
          // Cobre tambem o "parar de compartilhar" da barra do navegador, que
          // nao passa pela nossa interface.
          setLocalSharing(false);
          socket.emit("voice:streaming", false);
        },
        onError: (message) => setVoiceError(message),
        /**
         * Token de midia novo para a sala atual. A `room.ts` chama quando a
         * conexao com o SFU cai de vez; o gateway revalida a permissao e
         * reemite. `null` quando o socket esta fora ou o gateway recusa/demora
         * — ai a `room.ts` para de tentar (e, se o socket voltar, o
         * `RealtimeProvider` religa a call por inteiro).
         */
        renovarCredencial: () =>
          new Promise<MediaGrant | null>((resolve) => {
            if (!socket.connected) {
              resolve(null);
              return;
            }
            let respondido = false;
            const encerra = (grant: MediaGrant | null) => {
              if (respondido) return;
              respondido = true;
              resolve(grant);
            };
            socket.emit("voice:refresh-token", (r) => {
              if (r.ok) {
                setVoiceError(null);
                encerra(r.media);
              } else {
                setVoiceError(r.error);
                encerra(null);
              }
            });
            // A rede pode nunca devolver o ack — nao deixa a promessa pendurada.
            setTimeout(() => encerra(null), 8000);
          }),
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
        setRoomControls({
          setMicrophone: (deviceId) => handle.setMicrophone(deviceId),
          setOutputDevice: (deviceId) => handle.setOutputDevice(deviceId),
          setUserVolume: (userId, volume) =>
            handle.setUserVolume(userId, volume),
          setScreenAudioVolume: (volume) => handle.setScreenAudioVolume(volume),
          subscribeConnectionStats: (cb) => handle.subscribeConnectionStats(cb),
          definirSupressaoAvancada: (ligado) =>
            handle.definirSupressaoAvancada(ligado),
          definirForcaSupressao: (forca) => handle.definirForcaSupressao(forca),
          reaplicarTratamentoNativo: () => handle.reaplicarTratamentoNativo(),
          /**
           * A faixa local vai para a store DEPOIS de a camera ligar de fato.
           * Guardar antes deixaria o proprio bloco tentando desenhar uma faixa
           * que o dispositivo ainda podia recusar.
           */
          setCameraEnabled: async (enabled, deviceId) => {
            const deu = await handle.setCameraEnabled(enabled, deviceId);
            if (deu) {
              useRealtimeStore
                .getState()
                .setLocalCamera(enabled ? handle.localCameraTrack() : null);
            }
            return deu;
          },
          startShare: async (preset, withSystemAudio) => {
            const started = await handle.startScreenShare(
              preset,
              withSystemAudio,
            );
            if (started) {
              setLocalSharing(true, handle.localScreenTrack());
              setSharePreset(preset);
              socket.emit("voice:streaming", true);
            }
            return started;
          },
          /**
           * Troca a qualidade da transmissao ativa. Nao mexe em
           * `localSharing` nem avisa o gateway: para os outros nada mudou —
           * a mesma pessoa segue transmitindo a mesma faixa.
           */
          setSharePreset: async (preset) => {
            const changed = await handle.setSharePreset(preset);
            if (changed) setSharePreset(preset);
            return changed;
          },
          stopShare: async () => {
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
      setRoomControls(null);
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
    setSharePreset,
    setRoomControls,
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
