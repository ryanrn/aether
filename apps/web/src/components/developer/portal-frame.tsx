import Link from "next/link";
import { AetherIcon } from "@/components/ui/aether-icon";

/**
 * Moldura comum do Developer Portal — a marca no topo e a coluna de conteudo.
 * A lista e o detalhe compartilham; o detalhe injeta a sub-navegacao pela
 * `aside`.
 */
export function PortalFrame({
  voltar,
  aside,
  children,
}: {
  /** link de "voltar" no topo (null na lista) */
  voltar?: { href: string; texto: string };
  /** sub-nav do detalhe (Informacoes gerais / Bot / Instalacao) */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-base-950">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-5">
        <AetherIcon name="key" className="h-4 w-4 text-accent-400" />
        <span className="font-brand text-[13px] font-bold uppercase tracking-[0.16em] text-ink-100">
          Developer Portal
        </span>
        {voltar ? (
          <>
            <span className="text-ink-600">/</span>
            <Link
              href={voltar.href}
              className="inline-flex items-center gap-1.5 text-[13px] text-ink-400 hover:text-ink-200"
            >
              <AetherIcon name="arrow-left" className="h-3.5 w-3.5" />
              {voltar.texto}
            </Link>
          </>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1">
        {aside ? (
          <aside className="w-[220px] shrink-0 overflow-y-auto border-r border-line bg-base-900 p-3">
            {aside}
          </aside>
        ) : null}
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[760px] px-6 py-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
