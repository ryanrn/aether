import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent-500 text-base-950 hover:bg-accent-400 active:bg-accent-600 font-medium shadow-[0_0_20px_-8px_var(--color-accent-500)]",
  secondary:
    "bg-base-700 text-ink-100 hover:bg-base-600 active:bg-base-700 border border-base-600",
  outline:
    "border border-base-600 text-ink-200 hover:border-base-500 hover:text-ink-100 hover:bg-base-800",
  ghost: "text-ink-300 hover:text-ink-100 hover:bg-base-800",
  danger:
    "bg-signal-dnd/15 text-signal-dnd border border-signal-dnd/30 hover:bg-signal-dnd/25",
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
