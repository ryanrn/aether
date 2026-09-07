"use client";

/**
 * Volume por pessoa e volume do audio de tela.
 *
 * Preferencia LOCAL, e so isso: e o volume com que EU ouço os outros, nao uma
 * configuracao do servidor. Nao passa pelo gateway nem pelo banco — se
 * passasse, mexer no volume de alguem afetaria o que os outros ouvem, que e
 * exatamente o contrario do que se espera.
 *
 * Por isso mora no localStorage: sobrevive a recarregar a pagina, nao viaja
 * entre maquinas, e nao custa uma escrita no Postgres a cada arrastar de
 * slider.
 *
 * TETO DE 200% (`VOLUME_MAX`): todo volume no app vai de 0 a 2. Ate 100% e o
 * MIX RELATIVO entre as fontes; acima disso e GANHO de verdade.
 *
 * `HTMLMediaElement.volume` so aceita 0..1 (acima lanca IndexSizeError), entao
 * quem passa de 100% — o volume de uma pessoa, o do audio de tela, o de saida
 * global, ou o PRODUTO dos tres — cai no `room.ts`: ele muta o <audio> daquela
 * fonte e a toca por um `GainNode` proprio da Web Audio. So acima de 100%; ate
 * la o caminho de reproducao de sempre (que este projeto ja penou para acertar;
 * ver o comentario sobre `display:none` em room.ts) fica intocado.
 *
 * 200% e o mesmo teto do Discord. Passar disso nao deixa "mais alto", deixa
 * distorcido — o ganho multiplica a amplitude e o sinal satura.
 */

const USER_VOLUMES_KEY = "aether.volumes.users";
const SCREEN_VOLUME_KEY = "aether.volumes.screen";

export const DEFAULT_VOLUME = 1;

/** Teto de qualquer volume do app (por pessoa, tela, saida global). 2 = 200%. */
export const VOLUME_MAX = 2;

/** Garante 0..VOLUME_MAX — o slider e a origem do valor, mas localStorage e editavel. */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(VOLUME_MAX, Math.max(0, value));
}

export function readUserVolumes(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(USER_VOLUMES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, number> = {};
    for (const [userId, value] of Object.entries(parsed)) {
      if (typeof value === "number") result[userId] = clampVolume(value);
    }
    return result;
  } catch {
    return {};
  }
}

export function saveUserVolume(userId: string, volume: number): void {
  if (typeof window === "undefined") return;
  try {
    const all = readUserVolumes();
    if (volume === DEFAULT_VOLUME) delete all[userId];
    else all[userId] = clampVolume(volume);
    window.localStorage.setItem(USER_VOLUMES_KEY, JSON.stringify(all));
  } catch {
    // Modo anonimo com storage bloqueado: o volume vale so nesta sessao.
  }
}

export function readScreenVolume(): number {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  try {
    const raw = window.localStorage.getItem(SCREEN_VOLUME_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    return clampVolume(Number(raw));
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function saveScreenVolume(volume: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SCREEN_VOLUME_KEY, String(clampVolume(volume)));
  } catch {
    // idem
  }
}

/* -------------------------------------------------------------------------- */
/* Volume de saida global                                                    */
/* -------------------------------------------------------------------------- */

const OUTPUT_VOLUME_KEY = "aether.volumes.output";

/**
 * Volume de saida global (0..VOLUME_MAX). Multiplica TODO o audio que chega —
 * microfones e audio de tela — sobre o volume relativo de cada fonte. Comeca em
 * 100% (`DEFAULT_VOLUME`) para quem nunca mexeu.
 */
export function readOutputVolume(): number {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  try {
    const raw = window.localStorage.getItem(OUTPUT_VOLUME_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    return clampVolume(Number(raw));
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function saveOutputVolume(volume: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OUTPUT_VOLUME_KEY, String(clampVolume(volume)));
  } catch {
    // Modo anonimo com storage bloqueado: o volume vale so nesta sessao.
  }
}
