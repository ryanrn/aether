"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Seletor de emoji.
 *
 * DUAS DECISOES que valem estar escritas:
 *
 * 1. OS DADOS SAO LOCAIS, e nao do CDN. O `emoji-mart` busca o catalogo em
 *    `cdn.jsdelivr.net` quando nao recebe `data` — e a CSP deste app so libera
 *    `'self'`, o gateway e o LiveKit. Com o padrao, o seletor abriria VAZIO em
 *    producao e funcionaria no `npm run dev`, que e o pior jeito de quebrar.
 *    A alternativa seria afrouxar a CSP para um CDN inteiro; carregar 423 KB
 *    do proprio bundle custa menos.
 *
 * 2. NAO USA `@emoji-mart/react`. O wrapper oficial declara peer de React
 *    ate a 18, e este app esta na 19 — instalar exigiria `--legacy-peer-deps`,
 *    que e o tipo de coisa que passa hoje e quebra num `npm ci` futuro sem
 *    ninguem lembrar por que. O wrapper so monta o componente num `ref`, que e
 *    o que o `useEffect` abaixo faz em dez linhas.
 *
 * O carregamento e SOB DEMANDA (`import()` dentro do efeito): quem nunca abre o
 * seletor nao paga os 423 KB do catalogo nem o codigo da biblioteca.
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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const [posicao, setPosicao] = useState(anchor);

  /**
   * `onEscolher` numa ref para o efeito de montagem NAO depender dela.
   *
   * Sem isto, um pai que recria a funcao a cada render remontaria o seletor
   * inteiro — recarregando o catalogo e fechando o que a pessoa estava
   * navegando, a cada tecla digitada na busca.
   */
  const escolherRef = useRef(onEscolher);
  escolherRef.current = onEscolher;

  useEffect(() => {
    let vivo = true;
    let picker: { unmount?: () => void } | null = null;

    void (async () => {
      /**
       * O `i18n` TAMBEM vem local, e nao so o `data`.
       *
       * Descoberto na verificacao: passar `data` sozinho nao basta. Com
       * `locale: "pt"` e sem `i18n`, o emoji-mart vai buscar
       * `cdn.jsdelivr.net/.../i18n/pt.json` — e a CSP bloqueia, deixando o
       * seletor montado e VAZIO. Sao 776 bytes; carregar junto sai de graca.
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
        // Emoji do proprio sistema: nada de sprite baixada de fora.
        set: "native",
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
      className="fixed z-[70] overflow-hidden rounded-lg border border-base-700 shadow-xl"
    >
      {/* O `emoji-mart` monta aqui dentro. */}
      <div ref={hostRef} />
    </div>,
    document.body,
  );
}
