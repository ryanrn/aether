"use client";

import * as React from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { cn } from "@/lib/utils";

/**
 * Visor de imagem dentro do app.
 *
 * Antes, clicar numa imagem do chat abria uma aba do navegador (no desktop, o
 * navegador do SISTEMA, via `setWindowOpenHandler`) — sair do app para ver uma
 * foto. Agora expande aqui mesmo: fundo escuro, imagem no centro, `Esc` ou
 * clique no fundo para fechar, setas quando a mensagem tem varias.
 *
 * Mesmo primitivo do `Modal`: `<dialog>` nativo com `showModal()` da o foco
 * preso, o `Esc` e o `inert` do fundo de graca. Um botao no canto ainda abre a
 * imagem em tamanho real fora do app (com `download` para quem quiser salvar) —
 * o R2 nao esta em `connect-src`, entao buscar o blob aqui seria bloqueado.
 */

export interface ImagemDoVisor {
  url: string;
  nome: string;
  largura: number | null;
  altura: number | null;
}

export function ImageLightbox({
  images,
  open,
  startIndex = 0,
  onClose,
}: {
  images: ImagemDoVisor[];
  open: boolean;
  startIndex?: number;
  onClose: () => void;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const [index, setIndex] = React.useState(startIndex);

  // Ao abrir, comeca na imagem clicada. Enquanto aberto, as setas mandam.
  React.useEffect(() => {
    if (open) setIndex(startIndex);
  }, [open, startIndex]);

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const total = images.length;
  const atual = images[Math.min(index, total - 1)];

  const irPara = React.useCallback(
    (delta: number) => {
      if (total < 2) return;
      setIndex((i) => (i + delta + total) % total);
    },
    [total],
  );

  React.useEffect(() => {
    if (!open) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "ArrowRight") irPara(1);
      if (e.key === "ArrowLeft") irPara(-1);
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [open, irPara]);

  if (!atual) return null;

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Clique no backdrop do <dialog> conta como clique no proprio elemento.
        if (e.target === ref.current) onClose();
      }}
      aria-label={`Imagem: ${atual.nome}`}
      className="m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-black/85 backdrop:backdrop-blur-[2px]"
    >
      <div
        className="relative flex h-full w-full items-center justify-center p-4 sm:p-10"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* controles do canto */}
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
          <a
            href={atual.url}
            target="_blank"
            rel="noreferrer noopener"
            download={atual.nome}
            title="Abrir em tamanho real"
            aria-label="Abrir em tamanho real"
            onClick={(e) => e.stopPropagation()}
            className="grid h-10 w-10 place-items-center rounded-full border border-line-strong bg-base-950/70 text-ink-200 backdrop-blur transition-colors hover:bg-base-800 hover:text-ink-100 active:scale-95"
          >
            <AetherIcon name="link" className="h-[18px] w-[18px]" />
          </a>
          <AcaoDoVisor label="Fechar" onClick={onClose}>
            <AetherIcon name="x" className="h-[18px] w-[18px]" />
          </AcaoDoVisor>
        </div>

        {total > 1 ? (
          <>
            <AcaoDoVisor
              label="Anterior"
              onClick={() => irPara(-1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 sm:left-4"
            >
              <AetherIcon name="chevron" className="h-6 w-6 rotate-180" />
            </AcaoDoVisor>
            <AcaoDoVisor
              label="Proxima"
              onClick={() => irPara(1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 sm:right-4"
            >
              <AetherIcon name="chevron" className="h-6 w-6" />
            </AcaoDoVisor>
          </>
        ) : null}

        <figure className="flex max-h-full max-w-full flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={atual.url}
            alt={atual.nome}
            width={atual.largura ?? undefined}
            height={atual.altura ?? undefined}
            className="max-h-[82vh] max-w-full rounded-md object-contain shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)]"
          />
          <figcaption className="flex items-center gap-2 text-[12px] text-ink-300">
            <span className="max-w-[60vw] truncate">{atual.nome}</span>
            {total > 1 ? (
              <span className="font-mono text-ink-500">
                {index + 1} / {total}
              </span>
            ) : null}
          </figcaption>
        </figure>
      </div>
    </dialog>
  );
}

function AcaoDoVisor({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "grid h-10 w-10 place-items-center rounded-full border border-line-strong bg-base-950/70 text-ink-200 backdrop-blur transition-colors hover:bg-base-800 hover:text-ink-100 active:scale-95",
        className,
      )}
    >
      {children}
    </button>
  );
}
