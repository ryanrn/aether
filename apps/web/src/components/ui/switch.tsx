"use client";

import { cn } from "@/lib/utils";

/**
 * Chave liga/desliga — UMA implementacao para o app inteiro.
 *
 * Antes cada tela desenhava a sua: `spotify-section` tinha uma pilula propria,
 * `media-advanced` e as telas de privacidade/atividade usavam `<input
 * type="checkbox">` cru com `accent-*`. Tres aparencias para a mesma acao. O
 * redesign OpenDesign padroniza numa pilula (`.switch`) e numa linha
 * (`.toggle-row`); isto e a versao nativa dela.
 *
 * O elemento clicavel e sempre um `<button role="switch">` — o estado e
 * controlado pelo React, e um botao com `aria-checked` ja e anunciado
 * corretamente pelos leitores de tela sem o par label+input. A pilula em si
 * (`SwitchVisual`) e so um `<span>`, para poder viver DENTRO desse botao — no
 * `ToggleRow` a linha inteira e o alvo do clique.
 */

/**
 * A pilula, sem interacao. Reflete `checked`; nao captura clique.
 *
 * Exportada para quando a linha INTEIRA ja e um `<button>` (nao da para aninhar
 * o `Switch`, que tambem e botao) — ver o popover de ruido do dock.
 */
export function SwitchVisual({
  checked,
  disabled,
}: {
  checked: boolean;
  disabled?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-pill border transition-colors duration-150",
        disabled && "opacity-40",
        checked
          ? "border-transparent bg-accent-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_1px_10px_-3px_var(--color-accent-500)]"
          : "border-line-strong bg-base-700 shadow-[inset_0_1px_2px_rgba(0,0,0,0.45)]",
      )}
    >
      <span
        className={cn(
          "absolute left-[3px] h-[18px] w-[18px] rounded-pill bg-white shadow-[0_2px_5px_rgba(0,0,0,0.5)] transition-transform duration-200",
          checked && "translate-x-4",
        )}
      />
    </span>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  label,
  id,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** rotulo acessivel — obrigatorio quando o switch nao tem texto ao lado */
  label?: string;
  id?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "rounded-pill transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent-500 disabled:cursor-not-allowed active:scale-95",
        className,
      )}
    >
      <SwitchVisual checked={checked} disabled={disabled} />
    </button>
  );
}

/**
 * Linha de configuracao: titulo + descricao a esquerda, a pilula a direita, e
 * um fio entre linhas consecutivas. A LINHA INTEIRA e clicavel. Empilhe varias
 * num container.
 */
export function ToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled = false,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "grid w-full grid-cols-[1fr_auto] items-start gap-4 border-t border-line-soft py-3.5 text-left first:border-t-0",
        "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-500",
        disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer",
      )}
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium leading-snug text-ink-100">
          {title}
        </span>
        {description ? (
          <span className="mt-1 block text-[12px] leading-snug text-ink-400">
            {description}
          </span>
        ) : null}
      </span>
      <span className="pt-0.5">
        <SwitchVisual checked={checked} disabled={disabled} />
      </span>
    </button>
  );
}
