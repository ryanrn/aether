"use client";

/**
 * Medidor de nivel do microfone, para a tela de configuracoes.
 *
 * Serve para responder "meu microfone esta funcionando?" sem precisar entrar
 * numa call e perguntar para alguem. E o mesmo principio do `voice-activity`
 * — ler a energia (RMS) do proprio microfone no navegador — mas com um
 * proposito diferente, e por isso e outro arquivo:
 *
 *  - `voice-activity` reporta um BOOLEANO (falando / em silencio) e emite so
 *    nas transicoes, porque isso vai pelo socket para os outros;
 *  - aqui devolvemos o nivel CONTINUO de 0 a 1, que nunca sai desta maquina.
 *
 * O audio nao e gravado, nem enviado, nem guardado. Ele existe enquanto a tela
 * de configuracoes esta aberta e some junto com ela.
 */

const SAMPLE_INTERVAL_MS = 60;

export interface MicLevelHandle {
  stop: () => void;
}

export async function startMicLevel({
  deviceId,
  onLevel,
}: {
  /** aparelho especifico; ausente = padrao do sistema */
  deviceId?: string | null;
  onLevel: (level: number) => void;
}): Promise<MicLevelHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  });

  const context = new AudioContext();
  // Politica de autoplay pode entregar o contexto suspenso; sem retomar, o
  // analisador le silencio para sempre e o medidor parece quebrado.
  if (context.state === "suspended") await context.resume();

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.2;
  source.connect(analyser);
  // NAO conectamos ao destino: ligar no alto-falante devolveria o proprio
  // microfone como eco enquanto a pessoa testa.

  const buffer = new Uint8Array(analyser.fftSize);
  let stopped = false;

  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (const sample of buffer) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / buffer.length);
    /**
     * Multiplicamos por 4 porque voz normal fica na casa de 0,02–0,15 de RMS:
     * sem isso a barra mal sairia do lugar e pareceria que o microfone nao
     * pega nada.
     */
    onLevel(Math.min(1, rms * 4));
  }, SAMPLE_INTERVAL_MS);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      for (const track of stream.getTracks()) track.stop();
      void context.close().catch(() => undefined);
    },
  };
}
