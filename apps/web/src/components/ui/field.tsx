import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-md border border-base-600 bg-base-900 px-3 text-sm text-ink-100",
        "placeholder:text-ink-500 transition-colors duration-150",
        "hover:border-base-500 focus:border-accent-600 focus:outline-none",
        "disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400",
        className,
      )}
      {...props}
    />
  );
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="text-[13px] text-signal-dnd animate-in-fast">{children}</p>
  );
}

export function Field({
  label,
  hint,
  required = false,
  children,
}: {
  label: string;
  hint?: string;
  /**
   * Marca o campo como obrigatorio com um asterisco no rotulo.
   *
   * Existe porque os formularios de entrada perderam os placeholders: com o
   * campo vazio e sem dica, nada dizia o que era obrigatorio. O asterisco diz,
   * e sem fingir conteudo dentro da caixa.
   */
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        {label}
        {required ? (
          <span className="ml-1 text-signal-dnd" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {children}
      {hint ? <p className="text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}
