"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AetherIcon, type AetherIconName } from "@/components/ui/aether-icon";
import { cn } from "@/lib/utils";
import { PainelDeEmoji } from "./emoji-panel";
import { GifPicker, type GifEscolhido } from "./gif-picker";

/**
 * Seletor de midia do composer — abas Emoji · GIF · (Sticker em breve).
 *
 * O sticker ja tem aba parada de proposito: quando entrar, a estrutura da
 * grade/busca do `<GifPicker>` serve, e o unico trabalho e a fonte de dados.
 *
 * Portal + posicao + fechar-ao-clicar-fora moram aqui; o conteudo de cada aba
 * nao sabe nada disso.
 */
type Aba = "emoji" | "gif" | "sticker";

const ABAS: { id: Aba; rotulo: string; icone: AetherIconName }[] = [
  { id: "emoji", rotulo: "Emoji", icone: "smile" },
  { id: "gif", rotulo: "GIF", icone: "play" },
  { id: "sticker", rotulo: "Sticker", icone: "sparkle" },
];

export function MediaPicker({
  anchor,
  abaInicial = "emoji",
  onEmoji,
  onGif,
  onClose,
}: {
  anchor: { x: number; y: number };
  abaInicial?: Aba;
  onEmoji: (emoji: string) => void;
  onGif: (gif: GifEscolhido) => void;
  onClose: () => void;
}) {
  const [aba, setAba] = useState<Aba>(abaInicial);
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const [posicao, setPosicao] = useState(anchor);

  useEffect(() => {
    function noClique(e: MouseEvent) {
      if (!caixaRef.current?.contains(e.target as Node)) onClose();
    }
    function naTecla(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    const t = setTimeout(() => document.addEventListener("mousedown", noClique));
    document.addEventListener("keydown", naTecla);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", noClique);
      document.removeEventListener("keydown", naTecla);
    };
  }, [onClose]);

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
      className="fixed z-[70] flex h-[420px] w-[352px] flex-col overflow-hidden rounded-lg border border-line bg-base-900 shadow-xl"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-line p-1.5">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAba(a.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-medium transition-colors",
              aba === a.id
                ? "bg-base-750 text-ink-100"
                : "text-ink-400 hover:bg-base-850 hover:text-ink-200",
            )}
          >
            <AetherIcon name={a.icone} className="h-3.5 w-3.5" />
            {a.rotulo}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {aba === "emoji" ? (
          <PainelDeEmoji onEscolher={onEmoji} />
        ) : aba === "gif" ? (
          <GifPicker
            onEscolher={(g) => {
              onGif(g);
              onClose();
            }}
          />
        ) : (
          <div className="grid h-full place-items-center px-8 text-center">
            <p className="text-[12px] leading-relaxed text-ink-500">
              Stickers chegam depois. A base ja e a mesma do GIF.
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
