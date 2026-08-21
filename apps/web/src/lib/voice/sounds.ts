"use client";

/**
 * Avisos sonoros de entrada e saida de call.
 *
 * Sao SINTETIZADOS aqui, com osciladores, em vez de arquivos de audio. Motivos:
 * nao entra binario no repositorio, nao ha licenca de sample para resolver, e o
 * timbre fica ajustavel em uma linha. O custo em bytes e zero.
 *
 * Nada disso tem relacao com a voz: sao sons locais, tocados na sua maquina.
 * O gateway continua sem transportar audio.
 */

/**
 * Um contexto so, reaproveitado. Criar um AudioContext por som estoura o
 * limite do navegador depois de algumas dezenas de eventos.
 */
let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    sharedContext ??= new AudioContext();
    // A politica de autoplay pode entregar o contexto suspenso; a primeira
    // interacao do usuario (o clique em Conectar) libera.
    if (sharedContext.state === "suspended") void sharedContext.resume();
    return sharedContext;
  } catch {
    return null;
  }
}

/** Volume baixo de proposito: e um aviso, nao um alarme. */
const PEAK_GAIN = 0.07;
const TONE_MS = 90;
const GAP_MS = 60;

function tone(
  context: AudioContext,
  frequency: number,
  startAt: number,
  durationSeconds: number,
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  // Senoide pura soa "digital" sem ser estridente; triangle daria um timbre
  // mais duro do que combina com a interface.
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startAt);

  // Envelope curto: sem o ataque suave, o corte seco vira um "clique".
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSeconds);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + durationSeconds + 0.02);
}

function playSequence(frequencies: number[]): void {
  const context = getContext();
  if (!context) return;

  const now = context.currentTime;
  const duration = TONE_MS / 1000;
  const step = (TONE_MS + GAP_MS) / 1000;

  frequencies.forEach((frequency, index) => {
    tone(context, frequency, now + index * step, duration);
  });
}

/** Entrada: duas notas subindo (do quinto grau para a oitava). */
export function playJoinChime(): void {
  playSequence([523.25, 783.99]);
}

/** Saida: as mesmas notas descendo — a simetria e o que faz o par ser lido como par. */
export function playLeaveChime(): void {
  playSequence([783.99, 523.25]);
}
