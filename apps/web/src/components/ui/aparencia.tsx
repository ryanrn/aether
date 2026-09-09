"use client";

import { useEffect } from "react";
import { hidratarPrefsDoChat, usePrefsDoChat } from "@/lib/chat/prefs";

/**
 * Liga as preferencias GLOBAIS ao `<html>`: escala da interface, contraste,
 * movimento, animacao, legibilidade. O que e so do chat (fonte, densidade,
 * espacamentos) fica no container da lista, nao aqui.
 *
 * Nao renderiza nada. Montado uma vez, no layout de `/app`. A primeira pintura
 * ja vem certa por causa do script sem-flash em `app/layout.tsx`; este efeito
 * cobre as mudancas feitas depois, nas Configuracoes.
 */
export function AparenciaProvider() {
  useEffect(() => {
    hidratarPrefsDoChat();
  }, []);

  const escala = usePrefsDoChat((p) => p.escalaInterface);
  const contraste = usePrefsDoChat((p) => p.contrasteAlto);
  const movimento = usePrefsDoChat((p) => p.reduzirMovimento);
  const animacoes = usePrefsDoChat((p) => p.reduzirAnimacoes);
  const legibilidade = usePrefsDoChat((p) => p.legibilidade);

  useEffect(() => {
    const el = document.documentElement;
    el.style.zoom = escala === 1 ? "" : String(escala);
    aplicarBandeira(el, "contraste", contraste ? "alto" : null);
    aplicarBandeira(el, "movReduzido", movimento ? "1" : null);
    aplicarBandeira(el, "animReduzida", animacoes ? "1" : null);
    aplicarBandeira(el, "legibilidade", legibilidade ? "1" : null);
  }, [escala, contraste, movimento, animacoes, legibilidade]);

  /**
   * Ctrl/Cmd + `+` / `-` / `0` controlam a escala de acessibilidade — o mesmo
   * gesto do zoom nativo do navegador, mas mexendo na preferencia do app (que
   * persiste e reflete no slider). Chamamos `preventDefault` para o zoom do
   * Chrome/Electron nao disparar junto e dobrar o efeito.
   */
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.altKey) return;
      const { ajustarEscala, zerarEscala } = usePrefsDoChat.getState();
      switch (e.key) {
        case "=":
        case "+":
        case "Add": // Numpad+ em alguns layouts
          e.preventDefault();
          ajustarEscala(0.1);
          break;
        case "-":
        case "_":
        case "Subtract":
          e.preventDefault();
          ajustarEscala(-0.1);
          break;
        case "0":
          e.preventDefault();
          zerarEscala();
          break;
      }
    }
    window.addEventListener("keydown", aoTeclar, { passive: false });
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  return null;
}

function aplicarBandeira(el: HTMLElement, chave: string, valor: string | null) {
  if (valor === null) delete el.dataset[chave];
  else el.dataset[chave] = valor;
}

/**
 * Script sem-flash — string injetada no `<head>` do layout raiz. Le o mesmo
 * `localStorage` e aplica antes da primeira pintura, senao a interface piscaria
 * na escala 1 e depois saltaria para a escolhida.
 */
export const SCRIPT_APARENCIA = `
(function () {
  try {
    var p = JSON.parse(localStorage.getItem('aether:chat:prefs') || '{}');
    var e = document.documentElement;
    var s = typeof p.escalaInterface === 'number'
      ? Math.min(1.5, Math.max(0.8, p.escalaInterface)) : 1;
    if (s !== 1) e.style.zoom = String(s);
    if (p.contrasteAlto) e.dataset.contraste = 'alto';
    if (p.reduzirMovimento) e.dataset.movReduzido = '1';
    if (p.reduzirAnimacoes) e.dataset.animReduzida = '1';
    if (p.legibilidade) e.dataset.legibilidade = '1';
  } catch (_) {}
})();
`.trim();
