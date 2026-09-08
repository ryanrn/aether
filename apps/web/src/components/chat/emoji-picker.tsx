"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { urlTwemojiDeUnified } from "@/lib/emoji/twemoji";

/**
 * Seletor de emoji.
 *
 * TRES DECISOES que valem estar escritas:
 *
 * 1. OS DADOS SAO LOCAIS, e nao do CDN. O `emoji-mart` busca o catalogo em
 *    `cdn.jsdelivr.net` quando nao recebe `data` — e a CSP deste app so libera
 *    `'self'`, o gateway e o LiveKit. Com o padrao, o seletor abriria VAZIO em
 *    producao e funcionaria no `npm run dev`, que e o pior jeito de quebrar.
 *
 * 2. AS IMAGENS SAO TWEMOJI. O grid do emoji-mart pinta sempre por
 *    SPRITESHEET (o `spritesheet` fica fixo `true` no render dele) — entao o
 *    caminho e `getSpritesheetURL` apontando para a folha do proprio Twitter,
 *    servida de `/twemoji-sheet-64.png`. As mensagens usam os SVGs individuais
 *    (`lib/emoji/twemoji.ts`); as duas artes sao do mesmo conjunto.
 *
 * 3. NAO USA `@emoji-mart/react`. O wrapper oficial declara peer de React ate a
 *    18, e este app esta na 19. O `useEffect` abaixo faz o que o wrapper faria.
 *
 * O carregamento e SOB DEMANDA (`import()` dentro do efeito): quem nunca abre o
 * seletor nao paga os 423 KB do catalogo nem o codigo da biblioteca.
 */

/**
 * So o emoji-mart montado num `<div>` — sem portal, sem posicao, sem
 * fechar-ao-clicar-fora. Serve tanto ao `<EmojiPicker>` (reacao, com portal
 * proprio) quanto ao `<MediaPicker>` (composer, com abas).
 */
export function EmojiMartHost({
  onEscolher,
}: {
  onEscolher: (emoji: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  /**
   * `onEscolher` numa ref: um pai que recria a funcao a cada render nao pode
   * remontar o seletor inteiro (recarrega o catalogo, perde a navegacao).
   */
  const escolherRef = useRef(onEscolher);
  escolherRef.current = onEscolher;

  useEffect(() => {
    let vivo = true;
    let picker: { unmount?: () => void } | null = null;

    void (async () => {
      /**
       * O `i18n` TAMBEM vem local. Com `locale: "pt"` e sem `i18n`, o emoji-mart
       * busca `cdn.jsdelivr.net/.../i18n/pt.json` — a CSP bloqueia e o seletor
       * fica montado e VAZIO.
       */
      const [{ Picker }, dados, traducao] = await Promise.all([
        import("emoji-mart"),
        import("@emoji-mart/data"),
        import("@emoji-mart/data/i18n/pt.json"),
      ]);
      if (!vivo || !hostRef.current) return;

      picker = new Picker({
        data: dados.default,
        parent: hostRef.current,
        i18n: traducao.default,
        set: "twitter",
        getSpritesheetURL: () => "/twemoji-sheet-64.png",
        getImageURL: (_set: string, unified: string) =>
          urlTwemojiDeUnified(unified),
        theme: "dark",
        locale: "pt",
        previewPosition: "none",
        skinTonePosition: "none",
        onEmojiSelect: (emoji: { native?: string }) => {
          if (emoji?.native) escolherRef.current(emoji.native);
        },
      }) as unknown as { unmount?: () => void };
    })();

    return () => {
      vivo = false;
      picker?.unmount?.();
      if (hostRef.current) hostRef.current.innerHTML = "";
    };
  }, []);

  return <div ref={hostRef} />;
}

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
      className="fixed z-[70] overflow-hidden rounded-lg border border-line shadow-xl"
    >
      <EmojiMartHost onEscolher={onEscolher} />
    </div>,
    document.body,
  );
}
