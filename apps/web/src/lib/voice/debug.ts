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

/**
 * Como `mediaLog`, mas SEMPRE emite (via `console.warn`).
 *
 * O `mediaLog` fica calado sem `?debug=media` — otimo para o log verboso do
 * SFU, pessimo para "a call caiu e nao sei por que". Os eventos que contam
 * (desconexao e o motivo, reconexao, falha de dispositivo, recuperacao
 * esgotada) passam por aqui: aparecem no console do usuario e no `aether.log`
 * do desktop sem ninguem precisar ligar flag nenhuma.
 */
export function mediaWarn(event: string, detail?: unknown): void {
  const stamp = new Date().toISOString().slice(11, 23);
  if (detail === undefined) console.warn(`[voz ${stamp}] ${event}`);
  else console.warn(`[voz ${stamp}] ${event}`, detail);
}
