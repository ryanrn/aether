"use client";

/**
 * Medidor de nivel do microfone + monitoramento opcional ("ouvir a si mesmo").
 *
 * Serve para responder "meu microfone esta funcionando?" sem entrar numa call.
 * E o mesmo principio do `voice-activity` — ler a energia (RMS) do proprio
 * microfone no navegador — mas com proposito diferente:
 *
 *  - `voice-activity` reporta um BOOLEANO (falando / silencio) e emite so nas
 *    transicoes, porque isso vai pelo socket para os outros;
 *  - aqui devolvemos o nivel CONTINUO de 0 a 1, que nunca sai desta maquina.
 *
 * Com `monitor: true`, a faixa capturada tambem TOCA de volta — a pessoa ouve
 * a propria voz para ajustar posicao do microfone, ganho, etc. Isso passa por
 * um `<audio>` (e nao pelo `AudioContext.destination`) para poder respeitar o
 * alto-falante escolhido via `setSinkId`. Sem fones da eco; por isso e opt-in
 * e a interface avisa.
 *
 * O audio nao e gravado, nem enviado, nem guardado. Existe enquanto a tela que
 * o abriu esta viva e some junto com ela.
 */

const SAMPLE_INTERVAL_MS = 60;

export interface MicLevelHandle {
  stop: () => void;
  /** troca o alto-falante do monitoramento ao vivo (so faz algo com `monitor`) */
  setOutput: (deviceId: string | null) => Promise<void>;
}

export async function startMicLevel({
  deviceId,
  onLevel,
  monitor = false,
  outputDeviceId = null,
}: {
  /** aparelho de ENTRADA especifico; ausente = padrao do sistema */
  deviceId?: string | null;
  onLevel: (level: number) => void;
  /** tocar a propria voz de volta ("ouvir a si mesmo") */
  monitor?: boolean;
  /** alto-falante de SAIDA para o monitoramento */
  outputDeviceId?: string | null;
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
  // NAO conectamos o analisador ao destino: o `AudioContext.destination` ignora
  // `setSinkId` na maioria dos navegadores. O monitoramento sai pelo <audio>.

  /**
   * O caminho de "ouvir a si mesmo". `srcObject` recebe a MESMA faixa que o
   * analisador le. Um `<audio>` (nao anexado ao DOM) porque so ele expoe
   * `setSinkId` de forma ampla.
   */
  let monitorEl: HTMLAudioElement | null = null;
  if (monitor) {
    monitorEl = new Audio();
    monitorEl.srcObject = stream;
    monitorEl.autoplay = true;
    // O <audio> nunca deve ecoar para o microfone via cancelamento — deixamos
    // o volume cheio; quem controla a intensidade e a distancia do fone.
    monitorEl.volume = 1;
    if (outputDeviceId) {
      await trySetSinkId(monitorEl, outputDeviceId);
    }
    await monitorEl.play().catch(() => undefined);
  }

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
     * sem isso a barra mal sairia do lugar.
     */
    onLevel(Math.min(1, rms * 4));
  }, SAMPLE_INTERVAL_MS);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      if (monitorEl) {
        monitorEl.pause();
        monitorEl.srcObject = null;
        monitorEl = null;
      }
      for (const track of stream.getTracks()) track.stop();
      void context.close().catch(() => undefined);
    },
    async setOutput(id) {
      if (monitorEl && id) await trySetSinkId(monitorEl, id);
    },
  };
}

async function trySetSinkId(
  el: HTMLAudioElement,
  deviceId: string,
): Promise<void> {
  const withSink = el as HTMLAudioElement & {
    setSinkId?: (id: string) => Promise<void>;
  };
  if (typeof withSink.setSinkId !== "function") return;
  await withSink.setSinkId(deviceId).catch(() => undefined);
}
