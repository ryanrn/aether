import Image from "next/image";
import Link from "next/link";
import { BRAND, DOCUMENTOS_LEGAIS } from "@aether/shared";

/**
 * Cabecalho e rodape das paginas PUBLICAS (landing + legais).
 *
 * Releitura OpenDesign. Usa os tokens do `@theme` (`base-*`, `ink-*`,
 * `accent-*`, `line`) e a marca de verdade (`/marca.png`, gerada de
 * `assets/marca/icone.png`) no lugar da caixa CSS que a landing tinha antes.
 */

function Marca({
  tamanho = 30,
  texto = 17,
  priority = false,
}: {
  tamanho?: number;
  texto?: number;
  priority?: boolean;
}) {
  return (
    <Link
      href="/"
      aria-label={`${BRAND.name} — início`}
      className="inline-flex items-center gap-2.5"
    >
      <Image
        src="/marca.png"
        alt=""
        width={tamanho}
        height={tamanho}
        className="rounded-[8px]"
        priority={priority}
      />
      <span
        className="font-brand font-bold tracking-[0.22em] text-ink-100"
        style={{ fontSize: texto }}
      >
        {BRAND.name}
      </span>
    </Link>
  );
}

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-base-950/80 backdrop-blur-[14px]">
      <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-4 px-6 py-3 md:gap-8 md:px-8">
        <Marca priority />

        {!compact ? (
          <nav className="hidden gap-8 text-sm text-ink-400 md:flex">
            <a href="/#recursos" className="transition-colors hover:text-ink-100">
              Recursos
            </a>
            <a
              href="/#como-funciona"
              className="transition-colors hover:text-ink-100"
            >
              Como funciona
            </a>
            <a
              href="/#privacidade"
              className="transition-colors hover:text-ink-100"
            >
              Privacidade
            </a>
          </nav>
        ) : null}

        <div className="flex flex-none items-center gap-1.5 md:gap-2">
          <Link
            href="/login"
            className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-ink-100 transition-colors hover:text-accent-400"
          >
            Entrar
          </Link>
          <Link
            href="/register"
            className="whitespace-nowrap rounded-md border border-line bg-white/5 px-3.5 py-2 text-sm font-medium text-ink-100 transition-colors hover:border-line-strong hover:bg-white/[0.09]"
          >
            Criar conta
          </Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative z-[1] border-t border-line py-14">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-5 px-6 md:px-8">
        <Marca tamanho={28} texto={15} />
        <div className="flex flex-wrap items-center gap-5 font-mono text-xs text-ink-400">
          <span>Beta · {BRAND.tagline}</span>
          {DOCUMENTOS_LEGAIS.map((d) => (
            <Link
              key={d.slug}
              href={`/${d.slug}`}
              className="transition-colors hover:text-ink-100"
            >
              {d.titulo}
            </Link>
          ))}
          <a
            href={BRAND.downloadUrl}
            target="_blank"
            rel="noopener"
            className="transition-colors hover:text-ink-100"
          >
            Baixar
          </a>
        </div>
      </div>
    </footer>
  );
}
