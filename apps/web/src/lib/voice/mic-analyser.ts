"use client";

/**
 * Mede a energia (RMS, 0..1) de uma faixa de audio ao vivo — sem toca-la em
 * nenhum alto-falante (isso devolveria o proprio microfone como eco).
 *
 * Reaproveitado pela deteccao de fala com SFU (`room.ts`, sobre a faixa que o
 * LiveKit ja publica) e sem SFU (`voice-activity.ts`, sobre um getUserMedia
 * proprio).
 */

export interface MicAnalyser {
  /** energia atual, 0..1 */
  rms(): number;
  /** aponta para outra faixa (troca de microfone) sem recriar o AudioContext */
  retarget(track: MediaStreamTrack): void;
  close(): void;
}

export async function createMicAnalyser(
  track: MediaStreamTrack,
): Promise<MicAnalyser> {
  const context = new AudioContext();
  // Politica de autoplay pode entregar o contexto suspenso; sem retomar, o
  // analisador le silencio para sempre.
  if (context.state === "suspended") await context.resume();

  const analyser = context.createAnalyser();
  /**
   * `fftSize` pequeno = janela curta = leitura mais fresca. `smoothingTime`
   * ZERO de proposito: a suavizacao mora na porta de fala; aqui ela so
   * atrasaria o ataque.
   */
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0;

  let source: MediaStreamAudioSourceNode | null = null;
  const buffer = new Uint8Array(analyser.fftSize);

  function retarget(next: MediaStreamTrack): void {
    source?.disconnect();
    source = context.createMediaStreamSource(new MediaStream([next]));
    source.connect(analyser);
  }
  retarget(track);

  return {
    rms() {
      analyser.getByteTimeDomainData(buffer);
      // getByteTimeDomainData centra o silencio em 128; normaliza para -1..1.
      let sum = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const sample = ((buffer[i] ?? 128) - 128) / 128;
        sum += sample * sample;
      }
      return Math.sqrt(sum / buffer.length);
    },
    retarget,
    close() {
      source?.disconnect();
      analyser.disconnect();
      void context.close().catch(() => undefined);
    },
  };
}
