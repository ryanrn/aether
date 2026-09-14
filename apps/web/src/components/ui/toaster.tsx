"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AetherIcon, type AetherIconName } from "@/components/ui/aether-icon";
import { useToastStore, type ToastItem, type TipoDeToast } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";

/** Tempo na tela antes de sumir sozinho. */
const DURACAO_MS = 4000;

const ICONE: Record<TipoDeToast, AetherIconName> = {
  sucesso: "check",
  erro: "alert",
  info: "bell",
};

const COR: Record<TipoDeToast, string> = {
  sucesso: "border-signal-online/30 text-signal-online",
  erro: "border-signal-dnd/30 text-signal-dnd",
  info: "border-accent-line text-accent-300",
};

/**
 * Monta UMA vez no layout raiz do app logado. Pilha no canto inferior — nao
 * disputa espaco com a HUD de voz, que fica centralizada embaixo.
 */
export function Toaster() {
  const itens = useToastStore((estado) => estado.itens);

  if (typeof document === "undefined") return null;
  if (itens.length === 0) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-[80] flex w-[min(360px,calc(100vw-2.5rem))] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {itens.map((item) => (
        <Toast key={item.id} item={item} />
      ))}
    </div>,
    document.body,
  );
}

function Toast({ item }: { item: ToastItem }) {
  const remover = useToastStore((estado) => estado.remover);

  useEffect(() => {
    const timer = window.setTimeout(() => remover(item.id), DURACAO_MS);
    return () => window.clearTimeout(timer);
  }, [item.id, remover]);

  return (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-base-850 px-3.5 py-3 shadow-[var(--shadow-pop)] animate-rise",
        COR[item.tipo],
      )}
    >
      <AetherIcon name={ICONE[item.tipo]} className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink-200">
        {item.texto}
      </p>
      <button
        type="button"
        onClick={() => remover(item.id)}
        aria-label="Fechar"
        className="-mr-1 -mt-0.5 shrink-0 rounded-sm p-0.5 text-ink-500 transition-colors hover:bg-base-700 hover:text-ink-100"
      >
        <AetherIcon name="x" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
