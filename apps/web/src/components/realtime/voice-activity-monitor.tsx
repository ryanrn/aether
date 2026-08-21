"use client";

import { useEffect, useRef } from "react";
import { useSelfVoice, useRealtimeStore } from "@/lib/stores/realtime-store";
import { useSocket } from "@/components/realtime/realtime-provider";
import {
  startVoiceActivity,
  type VoiceActivityHandle,
} from "@/lib/voice/voice-activity";

/**
 * Liga a deteccao de fala enquanto voce estiver em um canal de voz.
 *
 * Fica montado no layout do servidor, e nao na pagina do canal, porque a call
 * continua quando voce navega para um canal de texto — como no Discord. Se
 * vivesse na pagina, sair da tela do canal apagaria seu indicador para todos.
 *
 * O microfone e aberto ao entrar na call e SOLTO ao sair: o indicador de
 * "microfone em uso" do navegador acompanha o estado real.
 */
export function VoiceActivityMonitor() {
  const socket = useSocket();
  const selfVoice = useSelfVoice();
  const setVoiceError = useRealtimeStore((state) => state.setVoiceError);

  const inVoice = selfVoice?.channelId != null;
  const muted = selfVoice?.selfMuted ?? false;

  /**
   * Mute entra por ref para nao reiniciar a captura a cada clique no
   * microfone — reabrir o dispositivo levaria centenas de milissegundos.
   */
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    if (!inVoice || !socket) return;

    let handle: VoiceActivityHandle | null = null;
    let cancelled = false;

    startVoiceActivity({
      onChange: (speaking) => {
        // Mutado nunca sinaliza fala. O gateway tambem impoe isso; aqui
        // evitamos o trafego inutil.
        if (speaking && mutedRef.current) return;
        socket.emit("voice:speaking", speaking);
      },
    })
      .then((started) => {
        if (cancelled) {
          started.stop();
          return;
        }
        handle = started;
        setVoiceError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const denied =
          error instanceof DOMException &&
          (error.name === "NotAllowedError" ||
            error.name === "SecurityError");
        setVoiceError(
          denied
            ? "Microfone bloqueado pelo navegador. Voce continua na call, mas o indicador de fala nao vai funcionar."
            : "Nao foi possivel abrir o microfone para detectar fala.",
        );
      });

    return () => {
      cancelled = true;
      handle?.stop();
      // Sair da call sem apagar o indicador deixaria voce "falando" para
      // sempre na tela dos outros.
      socket.emit("voice:speaking", false);
      setVoiceError(null);
    };
  }, [inVoice, socket, setVoiceError]);

  useEffect(() => {
    // Mutar deve apagar o indicador imediatamente, sem esperar o silencio.
    if (muted) socket?.emit("voice:speaking", false);
  }, [muted, socket]);

  return null;
}
