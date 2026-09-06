import Link from "next/link";
import { BRAND, DOCUMENTOS_LEGAIS, VERSAO_DOS_TERMOS } from "@aether/shared";

/**
 * Casca das paginas legais: uma coluna de leitura, tipografia de texto longo,
 * e a navegacao entre os tres documentos. Publica — nao exige sessao.
 */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-base-950 text-ink-200">
      <div className="mx-auto max-w-[720px] px-5 py-12">
        <Link
          href="/"
          className="font-brand text-[15px] font-bold tracking-[0.2em] text-ink-100"
        >
          {BRAND.name}
        </Link>

        <nav className="mt-8 flex flex-wrap gap-x-4 gap-y-1 border-b border-line pb-3 text-[13px]">
          {DOCUMENTOS_LEGAIS.map((d) => (
            <Link
              key={d.slug}
              href={`/${d.slug}`}
              className="text-ink-400 transition-colors hover:text-ink-100"
            >
              {d.titulo}
            </Link>
          ))}
        </nav>

        <article className="prose-legal mt-8">{children}</article>

        <p className="mt-12 border-t border-line pt-4 text-[12px] text-ink-500">
          Versão {VERSAO_DOS_TERMOS}. Este é um documento inicial de um produto
          em beta; será revisado por um profissional jurídico antes do
          lançamento público.
        </p>
      </div>
    </div>
  );
}
