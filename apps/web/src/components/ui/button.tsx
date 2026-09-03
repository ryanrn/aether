import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent-500 text-white font-medium hover:bg-accent-400 active:bg-accent-600 shadow-[0_0_20px_-6px_var(--color-accent-500)]",
  secondary:
    "bg-base-700 text-ink-100 font-medium hover:bg-base-600 active:bg-base-700 border border-line-strong/50 hover:border-line-strong/60",
  outline:
    "border border-line-strong text-ink-200 font-medium hover:border-line-strong hover:text-ink-100 hover:bg-base-800 active:bg-base-750",
  ghost:
    "text-ink-300 font-medium hover:text-ink-100 hover:bg-base-850 active:bg-base-800",
  danger:
    "bg-signal-dnd text-white font-medium hover:bg-signal-dnd/90 active:bg-signal-dnd/80 shadow-[0_0_16px_-6px_var(--color-signal-dnd)]",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] rounded-sm",
  md: "h-10 px-4 text-sm rounded-md",
  lg: "h-11 px-5 text-sm rounded-md",
  icon: "h-9 w-9 rounded-md",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = "secondary", size = "md", type = "button", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors duration-150",
          "disabled:pointer-events-none disabled:opacity-45",
          VARIANTS[variant],
          SIZES[size],
          className,
        )}
        {...props}
      />
    );
  },
);
