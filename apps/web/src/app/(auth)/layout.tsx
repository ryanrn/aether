import Image from "next/image";
import Link from "next/link";
import { BRAND, DOCUMENTOS_LEGAIS } from "@aether/shared";

/**
 * Casca de entrar / criar conta / recuperar senha.
 *
 * Releitura OpenDesign (projeto `55f7f8c1-...`, a tela nova de login): um
 * cartao centralizado sobre atmosfera escura, no lugar do layout de duas
 * colunas anterior. As paginas renderizam só o cabeçalho + o form; a marca, o
 * "voltar ao início" e o rodapé legal moram aqui — atrás do cartão, não
 * dentro dele, pra `login`/`register`/`esqueci` compartilharem a mesma casca.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="auth-atmosphere relative min-h-dvh overflow-hidden bg-base-950 text-ink-200">
      <div aria-hidden className="auth-blob auth-blob--a" />
      <div aria-hidden className="auth-blob auth-blob--b" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 50%, transparent 55%, color-mix(in oklch, black 55%, transparent) 100%)",
        }}
      />

      <main className="relative z-[1] flex min-h-dvh flex-col items-center justify-center gap-7 px-6 py-12">
        <Link
          href="/"
          aria-label={`${BRAND.name} — início`}
          className="inline-flex items-center gap-2.5 text-ink-300 transition-colors hover:text-ink-100"
        >
          <Image src="/marca.png" alt="" width={26} height={26} className="rounded-[7px]" />
          <span className="font-brand text-[13px] font-bold tracking-[0.22em]">
            {BRAND.name}
          </span>
        </Link>

        <div className="w-full max-w-[440px] rounded-xl border border-line bg-base-900/85 px-9 py-10 shadow-[0_30px_70px_-20px_rgba(0,0,0,0.65)] backdrop-blur-2xl min-[480px]:px-10">
          {children}
        </div>

        <p className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[11px] text-ink-500">
          {DOCUMENTOS_LEGAIS.map((d) => (
            <Link
              key={d.slug}
              href={`/${d.slug}`}
              className="transition-colors hover:text-ink-300"
            >
              {d.titulo}
            </Link>
          ))}
        </p>
      </main>
    </div>
  );
}
