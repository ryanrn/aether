"use client";

/**
 * Porta de fala: recebe UMA amostra de energia (RMS, 0..1) por vez e decide,
 * com histerese e piso de ruido adaptativo, quando a pessoa comecou ou parou
 * de falar. Chama `onChange` APENAS nas transicoes.
 *
 * Por que existe separada da captura: a mesma logica serve o caminho COM SFU
 * (analisa a faixa que o LiveKit ja publica, ver `room.ts`) e o SEM SFU
 * (`voice-activity.ts`, um getUserMedia proprio). E por ser pura, e testavel
 * sem Web Audio.
 *
 * Depois do aquecimento, o ataque e IMEDIATO — a bordinha acende na amostra em
 * que a energia cruza o limiar, sem esperar N amostras de confirmacao. O
 * Discord faz assim; a espera de confirmacao era o que fazia falas curtas nao
 * acenderem nada.
 *
 * O piso de RUIDO e aprendido continuamente enquanto em silencio (rapido nas
 * primeiras amostras, devagar depois) e NUNCA e jogado fora: cada pausa deixa
 * a estimativa um pouco melhor. Aprender durante a fala e que faria o proprio
 * falante elevar o limiar ate se cortar — isso a gente nao faz.
 */

export interface SpeechGate {
  /** uma amostra de energia; `now` em ms (Date.now / performance.now) */
  push(rms: number, now: number): void;
  /** forca silencio imediatamente (mute); o piso de ruido aprendido e mantido */
  silence(): void;
}

export interface SpeechGateOptions {
  /** chamado so nas transicoes falando <-> silencio */
  onChange: (speaking: boolean) => void;
  /**
   * Piso absoluto: nunca abre abaixo disto. Voz normal fica em 0,02–0,15 de
   * RMS; o limiar fixo antigo era 0,02, bem em cima da voz, e por isso falas
   * baixas nao acendiam. 0,009 pega voz baixa em sala silenciosa; o piso
   * adaptativo cobre a sala barulhenta.
   */
  floor?: number;
  /** quantas vezes acima do ruido de fundo estimado conta como fala */
  overNoise?: number;
  /** o silencio precisa durar isto para apagar (evita piscar entre palavras) */
  releaseMs?: number;
  /**
   * Amostras iniciais em que a porta SO aprende o ruido e nao abre. O
   * analisador roda desde que a pessoa entra na call, muito antes de ela
   * falar, entao na pratica isso ja passou quando a primeira palavra sai.
   */
  warmupSamples?: number;
}

export function createSpeechGate(opts: SpeechGateOptions): SpeechGate {
  const floor = opts.floor ?? 0.009;
  const overNoise = opts.overNoise ?? 1.9;
  const releaseMs = opts.releaseMs ?? 220;
  const warmup = opts.warmupSamples ?? 6;

  let speaking = false;
  let quietSince: number | null = null;
  let observados = 0;
  /** estimativa do ruido de fundo; comeca no piso */
  let noise = floor;

  /** limiar de ABERTURA agora, dado o ruido aprendido */
  function abertura(): number {
    return Math.max(floor, noise * overNoise);
  }

  return {
    push(rms, now) {
      observados += 1;
      const aquecendo = observados <= warmup;

      if (!speaking) {
        /**
         * Aprende o ruido (EMA), so em silencio. Rapido no aquecimento para
         * convergir antes da primeira fala; devagar depois. A amostra entra
         * LIMITADA a 5x o piso: um estalo forte nao pode empurrar a
         * estimativa a ponto de o limiar passar da voz.
         */
        const alpha = aquecendo ? 0.35 : 0.08;
        noise = noise * (1 - alpha) + Math.min(rms, floor * 5) * alpha;
        if (!aquecendo && rms >= abertura()) {
          speaking = true;
          quietSince = null;
          opts.onChange(true);
        }
        return;
      }

      // Enquanto falando: fecha so com folga (60% do limiar de abertura).
      if (rms >= abertura() * 0.6) {
        quietSince = null;
        return;
      }
      quietSince ??= now;
      if (now - quietSince >= releaseMs) {
        speaking = false;
        quietSince = null;
        opts.onChange(false);
      }
    },

    silence() {
      quietSince = null;
      if (speaking) {
        speaking = false;
        opts.onChange(false);
      }
    },
  };
}
