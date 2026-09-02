"use client";

/**
 * Deteccao de fala a partir do proprio microfone — no navegador, sem enviar
 * audio a lugar nenhum.
 *
 * CAMINHO SEM SFU. Quando o LiveKit esta configurado, quem mede a fala e o
 * `room.ts`, sobre a faixa que ja esta publicada (ver `voice-session.tsx`).
 * Este arquivo continua existindo porque o app tem de funcionar sem SFU: ai a
 * bordinha de "falando" ainda acende, mesmo sem audio trafegando.
 *
 * O que sai desta maquina e um BOOLEANO pelo socket. O audio nunca e
 * transmitido, gravado nem guardado.
 *
 * A logica de decidir "falando/silencio" (piso adaptativo, ataque imediato,
 * release curto) mora em `speech-gate.ts`, compartilhada com o caminho COM
 * SFU — porque a bordinha tem de acender igual nos dois.
 */

import { createMicAnalyser } from "./mic-analyser";
import { createSpeechGate } from "./speech-gate";

/** ~33 leituras por segundo: fresco o bastante para o ataque parecer instantaneo. */
const SAMPLE_INTERVAL_MS = 30;

export interface VoiceActivityHandle {
  stop: () => void;
}

export async function startVoiceActivity({
  onChange,
}: {
  /** chamado APENAS na transicao entre falando e em silencio */
  onChange: (speaking: boolean) => void;
}): Promise<VoiceActivityHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const track = stream.getAudioTracks()[0];
  if (!track) {
    for (const t of stream.getTracks()) t.stop();
    throw new Error("microfone abriu sem faixa de audio");
  }

  const analyser = await createMicAnalyser(track);
  const gate = createSpeechGate({ onChange });

  const timer = setInterval(() => {
    gate.push(analyser.rms(), performance.now());
  }, SAMPLE_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(timer);
      analyser.close();
      // Soltar as faixas apaga o indicador de microfone em uso do navegador.
      for (const t of stream.getTracks()) t.stop();
      // Se parou falando, os outros precisam ver a bordinha apagar.
      gate.silence();
    },
  };
}
