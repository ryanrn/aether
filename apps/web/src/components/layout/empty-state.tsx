import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-[420px] text-center">
        <div
          aria-hidden
          className="mx-auto mb-5 h-px w-16"
          style={{
            background:
              "linear-gradient(to right, transparent, var(--color-accent-600), transparent)",
          }}
        />
        <h2 className="text-balance text-base font-semibold text-ink-100">
          {title}
        </h2>
        <p className="mt-2 text-balance text-[13px] leading-relaxed text-ink-400">
          {description}
        </p>
        {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}
