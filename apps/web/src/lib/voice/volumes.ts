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
 * TETO DE 100%: `HTMLMediaElement.volume` aceita 0..1 por especificacao —
 * valor acima disso lanca IndexSizeError. Amplificar exigiria rotear o audio
 * por um GainNode da Web Audio API, o que significa mexer no caminho de
 * reproducao inteiro. Este projeto ja apanhou de reproducao de audio (ver o
 * comentario sobre display:none em room.ts), e trocar "consigo abaixar quem
 * esta alto" por "posso ter quebrado o audio de todo mundo" nao vale. Fica
 * anotado nas limitacoes.
 */

const USER_VOLUMES_KEY = "aether.volumes.users";
const SCREEN_VOLUME_KEY = "aether.volumes.screen";

export const DEFAULT_VOLUME = 1;

/** Garante 0..1 — o slider e a origem do valor, mas localStorage e editavel. */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, value));
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
