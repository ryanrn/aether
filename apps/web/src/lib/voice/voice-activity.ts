"use client";

/**
 * Deteccao de fala a partir do proprio microfone — no navegador, sem enviar
 * audio a lugar nenhum.
 *
 * O que acontece: pegamos o stream do microfone, medimos a energia do sinal
 * (RMS) a cada 50ms e decidimos "esta falando" ou "esta em silencio". O que
 * sai desta maquina e um BOOLEANO pelo socket. O audio em si nunca e
 * transmitido, nem gravado, nem guardado — a fase 4 e que vai transportar som.
 *
 * Por isso o navegador pede permissao de microfone a partir de agora: para
 * saber se voce esta falando e preciso ouvir voce localmente. Sem essa
 * permissao, a bordinha simplesmente nao acende, e mais nada quebra.
 */

/** Acima disto consideramos fala. Calibrado para voz normal com ruido de fundo. */
const OPEN_THRESHOLD = 0.02;
/** Abaixo disto consideramos silencio. A folga entre os dois evita tremeliques. */
const CLOSE_THRESHOLD = 0.012;
/**
 * Silencio precisa persistir este tempo antes de apagar o indicador. Sem isso
 * a borda piscaria nas pausas naturais entre palavras.
 */
const RELEASE_MS = 280;
const SAMPLE_INTERVAL_MS = 50;

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

  const context = new AudioContext();
  // Politica de autoplay pode entregar o contexto suspenso; sem retomar, o
  // analisador le silencio para sempre.
  if (context.state === "suspended") await context.resume();

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.2;
  source.connect(analyser);
  // De proposito NAO conectamos ao destino: ligar no alto-falante devolveria
  // o proprio microfone como eco.

  const buffer = new Uint8Array(analyser.fftSize);
  let speaking = false;
  let quietSince: number | null = null;

  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(buffer);

    // getByteTimeDomainData centra o silencio em 128; normalizamos para -1..1
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const sample = ((buffer[i] ?? 128) - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / buffer.length);

    if (!speaking) {
      if (rms > OPEN_THRESHOLD) {
        speaking = true;
        quietSince = null;
        onChange(true);
      }
      return;
    }

    if (rms > CLOSE_THRESHOLD) {
      quietSince = null;
      return;
    }
    const now = Date.now();
    quietSince ??= now;
    if (now - quietSince >= RELEASE_MS) {
      speaking = false;
      quietSince = null;
      onChange(false);
    }
  }, SAMPLE_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
      // Soltar as faixas apaga o indicador de microfone em uso do navegador.
      for (const track of stream.getTracks()) track.stop();
      void context.close().catch(() => undefined);
      if (speaking) onChange(false);
    },
  };
}
