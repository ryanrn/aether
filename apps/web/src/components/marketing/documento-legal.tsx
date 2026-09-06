import Link from "next/link";

/**
 * Layout de um documento legal: cabecalho (eyebrow + titulo + lede) e a grade
 * `[índice fixo | texto]`. O texto vem como `children` dentro de `.prose-legal`
 * (definido em `globals.css` a partir da spec do OpenDesign).
 */
export function DocumentoLegal({
  titulo,
  lede,
  indice,
  children,
}: {
  titulo: string;
  lede: string;
  /** âncoras da coluna lateral — `id` tem que casar com um `<h2 id>` no corpo */
  indice: { id: string; rotulo: string }[];
  children: React.ReactNode;
}) {
  return (
    <>
      <section className="border-b border-line py-[clamp(48px,7vw,88px)] pb-10">
        <div className="mx-auto max-w-[1120px] px-6 md:px-8">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-accent-300">
            Documento legal
          </p>
          <h1 className="mt-4 font-brand text-[clamp(34px,4.6vw,52px)] font-semibold leading-[1.08] tracking-[-0.01em] text-ink-100">
            {titulo}
          </h1>
          <p className="mt-4 max-w-[58ch] text-lg text-ink-300">{lede}</p>
        </div>
      </section>

      <section className="py-14 pb-24">
        <div className="mx-auto grid max-w-[1120px] items-start gap-16 px-6 md:px-8 min-[861px]:grid-cols-[200px_1fr]">
          <nav
            aria-label="Seções"
            className="flex flex-col gap-2.5 text-[13px] max-[860px]:flex-row max-[860px]:flex-wrap max-[860px]:gap-x-[18px] max-[620px]:hidden min-[861px]:sticky min-[861px]:top-24"
          >
            <span className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-400">
              Nesta página
            </span>
            {indice.map((i) => (
              <a
                key={i.id}
                href={`#${i.id}`}
                className="text-ink-400 transition-colors hover:text-ink-100"
              >
                {i.rotulo}
              </a>
            ))}
          </nav>

          <div className="prose-legal font-sans">{children}</div>
        </div>
      </section>
    </>
  );
}

/** Link interno padrão dentro de um documento legal. */
export function LinkLegal({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="text-accent-300 underline underline-offset-2">
      {children}
    </Link>
  );
}
