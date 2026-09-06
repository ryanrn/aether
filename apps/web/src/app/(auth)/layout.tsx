import Image from "next/image";
import Link from "next/link";
import { BRAND, DOCUMENTOS_LEGAIS } from "@aether/shared";

/**
 * Casca de entrar / criar conta / recuperar senha.
 *
 * Releitura OpenDesign: duas colunas — painel de marca à esquerda (some no
 * mobile) e a coluna do formulário à direita. As paginas renderizam só o
 * cabecalho + o form; o "voltar ao início", a marca mobile e o rodape legal
 * moram aqui.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-dvh bg-base-950 text-ink-200 min-[861px]:grid-cols-[1.05fr_1fr]">
      {/* painel de marca */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-line p-14 min-[861px]:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(680px 420px at 22% 12%, color-mix(in oklch, var(--color-accent-500) 20%, transparent), transparent 68%), radial-gradient(520px 360px at 88% 96%, color-mix(in oklch, var(--color-accent-500) 12%, transparent), transparent 70%)",
          }}
        />
        <Link
          href="/"
          aria-label={`${BRAND.name} — início`}
          className="relative inline-flex items-center gap-3"
        >
          <Image
            src="/marca.png"
            alt=""
            width={34}
            height={34}
            className="rounded-[9px]"
            priority
          />
          <span className="font-brand text-[19px] font-bold tracking-[0.22em] text-ink-100">
            {BRAND.name}
          </span>
        </Link>

        <Image
          src="/marca.png"
          alt="Ícone do AETHER — um A em azul elétrico com três pontos de conversa."
          width={148}
          height={148}
          className="relative self-center rounded-[26px] drop-shadow-[0_22px_55px_color-mix(in_oklch,var(--color-accent-500)_38%,transparent)]"
        />

        <div className="relative">
          <h2 className="font-brand text-[clamp(26px,2.6vw,34px)] font-semibold leading-[1.12] tracking-[-0.005em] text-ink-100">
            Suas mesas continuam abertas.
          </h2>
          <p className="mt-3 max-w-[40ch] text-[15px] text-ink-400">
            Canais persistentes, voz com tela e o histórico que não some quando a
            chamada acaba.
          </p>
        </div>

        <span className="relative font-mono text-[11px] uppercase tracking-[0.1em] text-ink-500">
          Beta aberto · {BRAND.tagline}
        </span>
      </aside>

      {/* coluna do formulário */}
      <main className="flex items-center justify-center px-6 py-11">
        <div className="w-full max-w-[400px]">
          <Link
            href="/"
            aria-label={`${BRAND.name} — início`}
            className="mb-8 flex items-center gap-2.5 min-[861px]:hidden"
          >
            <Image
              src="/marca.png"
              alt=""
              width={30}
              height={30}
              className="rounded-[8px]"
            />
            <span className="font-brand text-base font-bold tracking-[0.22em] text-ink-100">
              {BRAND.name}
            </span>
          </Link>

          <Link
            href="/"
            className="mb-7 inline-flex items-center gap-1.5 text-[13px] text-ink-400 transition-colors hover:text-ink-100"
          >
            ← Voltar ao início
          </Link>

          {children}

          <p className="mt-10 flex flex-wrap gap-3 border-t border-line-soft pt-4 text-[11px] text-ink-500">
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
        </div>
      </main>
    </div>
  );
}
