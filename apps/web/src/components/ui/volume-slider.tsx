"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { VOLUME_MAX } from "@/lib/voice/volumes";

/**
 * Slider de volume PADRAO do app — 0 a 200%, com amplificacao acima de 100%.
 *
 * Um lugar so: antes cada tela desenhava o proprio `<input type=range>` e os
 * limites divergiam (o cartao de perfil parava em 100%, o menu do palco ia a
 * 200%). A parte visual que o Tailwind nao alcanca — os pseudo-elementos do
 * thumb — mora em `globals.css` sob `.volume-slider`.
 *
 * `value` e `onChange` falam na MESMA unidade do resto do codigo de voz: 0..2,
 * onde 1 = 100%. A conversao pra porcentagem e interna.
 */
const MAX_PCT = Math.round(VOLUME_MAX * 100); // 200
/** Onde fica o "neutro" (100%) ao longo da trilha, 0..1. */
const NEUTRO = 1 / VOLUME_MAX; // 0.5

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(VOLUME_MAX, Math.max(0, v));
}

export function VolumeSlider({
  value,
  onChange,
  label,
  id,
  className,
}: {
  /** 0..VOLUME_MAX (1 = 100%) */
  value: number;
  /** recebe 0..VOLUME_MAX */
  onChange: (value: number) => void;
  /** texto pro leitor de tela */
  label: string;
  id?: string;
  className?: string;
}) {
  const pct = Math.round(clamp(value) * 100); // 0..200
  const ratio = pct / MAX_PCT; // 0..1
  const amplificado = pct > 100;
  const boost = pct > 150;
  /** arrastando ou com foco de teclado — mostra o balao */
  const [ativo, setAtivo] = useState(false);

  /** cor do thumb e do brilho: azul normal, ambar amplificado, vermelho no boost */
  const accent = boost
    ? "var(--color-signal-dnd)"
    : amplificado
      ? "#f59e0b"
      : "var(--color-accent-500)";

  /** o preenchimento acompanha o estado */
  const fill = boost
    ? "linear-gradient(90deg, #8b5cf6, #f59e0b 55%, #ef4444)"
    : amplificado
      ? "linear-gradient(90deg, #3b82f6, #8b5cf6 60%, #f59e0b)"
      : "linear-gradient(90deg, #3b82f6, #8b5cf6)";

  return (
    <div className={cn("group relative select-none", className)}>
      {/* balao com o valor enquanto arrasta */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -top-7 z-10 -translate-x-1/2 rounded-md border border-line-strong bg-base-950 px-1.5 py-0.5 font-mono text-[10px] tabular-nums shadow-md transition-opacity duration-150",
          boost
            ? "text-signal-dnd"
            : amplificado
              ? "text-[#f5b544]"
              : "text-ink-100",
          ativo ? "opacity-100" : "opacity-0",
        )}
        style={{ left: `${ratio * 100}%` }}
      >
        {pct}%
      </div>

      <div className="relative flex h-4 items-center">
        {/* trilha vazia */}
        <div className="pointer-events-none absolute inset-x-0 h-[6px] overflow-hidden rounded-full bg-white/[0.08] transition-colors duration-150 group-hover:bg-white/[0.13]">
          {/* preenchimento ate o valor atual */}
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-[width,background] duration-100"
            style={{ width: `${ratio * 100}%`, background: fill }}
          />
        </div>

        {/* marca do neutro (100%) — deixa claro que acima disso e amplificacao */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 h-[11px] w-px -translate-y-1/2 rounded-full bg-white/40"
          style={{ left: `${NEUTRO * 100}%` }}
        />

        <input
          id={id}
          type="range"
          min={0}
          max={MAX_PCT}
          step={1}
          value={pct}
          onChange={(event) => onChange(Number(event.target.value) / 100)}
          onPointerDown={() => setAtivo(true)}
          onPointerUp={() => setAtivo(false)}
          onPointerCancel={() => setAtivo(false)}
          onFocus={() => setAtivo(true)}
          onBlur={() => setAtivo(false)}
          aria-label={label}
          aria-valuetext={`${pct}%`}
          className="volume-slider relative z-[1] h-4 w-full"
          style={{ "--vs-accent": accent } as React.CSSProperties}
        />
      </div>

      {/* escala */}
      <div className="mt-1 flex justify-between font-mono text-[9px] text-ink-600">
        <span>0%</span>
        <span className={cn(amplificado && "text-ink-400")}>100%</span>
        <span className={cn(boost && "text-signal-dnd")}>{MAX_PCT}%</span>
      </div>
    </div>
  );
}
