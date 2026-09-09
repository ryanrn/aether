"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PainelDeEmoji } from "./emoji-panel";

/**
 * Seletor de emoji para REACAO — o painel proprio (`<PainelDeEmoji>`) dentro de
 * um popover posicionado no ponto do clique. O composer usa o `<MediaPicker>`,
 * que embrulha o mesmo painel numa aba.
 */
export function EmojiPicker({
  anchor,
  onEscolher,
  onClose,
}: {
  /** Onde o clique aconteceu, em coordenadas de tela. */
  anchor: { x: number; y: number };
  onEscolher: (emoji: string) => void;
  onClose: () => void;
}) {
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const [posicao, setPosicao] = useState(anchor);

  /** Fecha ao clicar fora ou apertar Esc — igual ao resto dos popovers. */
  useEffect(() => {
    function noClique(evento: MouseEvent) {
      if (!caixaRef.current?.contains(evento.target as Node)) onClose();
    }
    function naTecla(evento: KeyboardEvent) {
      if (evento.key === "Escape") onClose();
    }
    // `setTimeout` para o proprio clique que ABRIU nao fechar em seguida.
    const t = setTimeout(() => document.addEventListener("mousedown", noClique));
    document.addEventListener("keydown", naTecla);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", noClique);
      document.removeEventListener("keydown", naTecla);
    };
  }, [onClose]);

  /** Nao deixa passar da borda da janela. */
  useEffect(() => {
    const caixa = caixaRef.current;
    if (!caixa) return;
    const { width, height } = caixa.getBoundingClientRect();
    const folga = 8;
    setPosicao({
      x: Math.max(folga, Math.min(anchor.x, window.innerWidth - width - folga)),
      y: Math.max(folga, Math.min(anchor.y, window.innerHeight - height - folga)),
    });
  }, [anchor.x, anchor.y]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={caixaRef}
      style={{ left: posicao.x, top: posicao.y }}
      className="fixed z-[70] flex h-[360px] w-[340px] flex-col overflow-hidden rounded-lg border border-line bg-base-900 shadow-xl"
    >
      <PainelDeEmoji onEscolher={onEscolher} />
    </div>,
    document.body,
  );
}
