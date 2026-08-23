import Link from "next/link";
import { BRAND } from "@aether/shared";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/* fundo: grade tecnica + halo do acento */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse 70% 55% at 50% 40%, black 30%, transparent 75%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-18%] h-[420px] w-[820px] -translate-x-1/2 rounded-full blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--color-accent-500) 22%, transparent), transparent 65%)",
        }}
      />

      <div className="relative z-10 w-full max-w-[400px]">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-md border border-accent-600/40 bg-accent-500/10">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-accent-500 shadow-[0_0_12px_var(--color-accent-500)]" />
          </span>
          {/* A marca usa a fonte da marca — angular, e so aqui e no topo. */}
          <span className="font-brand text-[17px] font-bold tracking-[0.2em] text-ink-100">
            {BRAND.name}
          </span>
        </Link>

        <div className="rounded-lg border border-base-700 bg-base-850/90 p-6 shadow-[var(--shadow-panel)] backdrop-blur-sm surface-grain">
          {children}
        </div>

        <p className="mt-6 text-center text-xs text-ink-500">
          {BRAND.tagline} · voz, tela e texto
        </p>
      </div>
    </div>
  );
}
