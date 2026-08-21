"use client";

/**
 * Diagnostico da camada de midia, ligado por `?debug=media` na URL.
 *
 * Existe porque problema de WebRTC entre duas pessoas nao se reproduz na
 * maquina de quem desenvolve: quando "a tela nao aparece", o que resolve e
 * saber quais eventos chegaram no navegador de cada lado. Sem isto, a
 * alternativa e adivinhar.
 *
 * Fica desligado por padrao — log verboso do SFU em uso normal so atrapalha.
 */
export function mediaDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debug") === "media";
}

export function mediaLog(event: string, detail?: unknown): void {
  if (!mediaDebugEnabled()) return;
  const stamp = new Date().toISOString().slice(11, 23);
  if (detail === undefined) console.log(`[midia ${stamp}] ${event}`);
  else console.log(`[midia ${stamp}] ${event}`, detail);
}
