"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Modal minimo baseado em <dialog> nativo: foco preso, Esc fecha e backdrop
 * gratuitos, sem trazer uma biblioteca de UI inteira.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[min(440px,calc(100vw-2rem))] rounded-lg border border-base-600 bg-base-850 p-0 text-ink-200",
        "shadow-[var(--shadow-pop)] backdrop:bg-black/70 backdrop:backdrop-blur-[2px]",
        "open:animate-rise",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-base-700 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-ink-100">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-[13px] text-ink-400">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 -mt-1 rounded-sm p-1 text-ink-400 transition-colors hover:bg-base-700 hover:text-ink-100"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}
