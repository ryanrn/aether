import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND, DOCUMENTOS_LEGAIS } from "@aether/shared";
import { AetherIcon } from "@/components/ui/aether-icon";
import { getSession } from "@/server/auth/session";

export const metadata: Metadata = {
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description: BRAND.description,
};

/**
 * Landing. Quem esta logado vai direto para o app; quem nao esta ve o que e o
 * AETHER e como baixar. Beta ABERTO: qualquer um cria conta (confirma o
 * e-mail).
 */
export default async function IndexPage() {
  const session = await getSession();
  if (session) redirect("/app");

  return (
    <div className="min-h-dvh bg-base-950 text-ink-200">
      <div className="mx-auto flex max-w-[880px] flex-col px-5 py-10">
        <header className="flex items-center justify-between">
          <span className="font-brand text-[16px] font-bold tracking-[0.2em] text-ink-100">
            {BRAND.name}
          </span>
          <nav className="flex items-center gap-4 text-[13px]">
            <Link href="/login" className="text-ink-400 hover:text-ink-100">
              Entrar
            </Link>
            <Link
              href="/register"
              className="rounded-sm bg-accent-500 px-3.5 py-1.5 font-medium text-white hover:bg-accent-600"
            >
              Criar conta
            </Link>
          </nav>
        </header>

        <section className="mt-20 max-w-[560px]">
          <p className="font-mono text-[12px] uppercase tracking-[0.18em] text-accent-300">
            Beta aberto
          </p>
          <h1 className="mt-3 text-[34px] font-semibold leading-[1.1] text-ink-100">
            Voz, tela e texto para quem joga junto.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-400">
            Canais persistentes, chamadas com compartilhamento de tela, e um app
            de desktop que reconhece o que você está jogando — sem cadastrar
            executável na mão.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={BRAND.downloadUrl}
              target="_blank"
              rel="noopener"
              className="flex items-center gap-2 rounded-sm bg-accent-500 px-5 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-accent-600"
            >
              <AetherIcon name="download" className="h-4 w-4" />
              Baixar para Windows
            </a>
            <Link
              href="/register"
              className="rounded-sm border border-line-strong px-5 py-3 text-[14px] font-medium text-ink-200 transition-colors hover:bg-base-800"
            >
              Usar no navegador
            </Link>
          </div>
          <p className="mt-3 text-[12px] text-ink-500">
            Ao criar uma conta você confirma o e-mail e aceita os{" "}
            <Link href="/termos" className="text-accent-300 underline">
              Termos
            </Link>
            .
          </p>
        </section>

        <section className="mt-24 grid gap-6 sm:grid-cols-3">
          {[
            {
              icone: "gamepad" as const,
              titulo: "Reconhece o jogo",
              texto:
                "Lê o que a loja instalou (Steam, Epic, EA, Xbox…) e o config do anti-cheat — aparece na atividade sozinho.",
            },
            {
              icone: "screen-share" as const,
              titulo: "Tela sem travar",
              texto:
                "Compartilhamento de tela e câmera na call, com o áudio do sistema junto.",
            },
            {
              icone: "hash" as const,
              titulo: "Canais que ficam",
              texto:
                "Servidores, cargos e canais de texto e voz. O histórico não some quando a call acaba.",
            },
          ].map((f) => (
            <div key={f.titulo}>
              <div className="grid h-9 w-9 place-items-center rounded-md bg-accent-500/12">
                <AetherIcon name={f.icone} className="h-4 w-4 text-accent-300" />
              </div>
              <h3 className="mt-3 text-[14px] font-semibold text-ink-100">
                {f.titulo}
              </h3>
              <p className="mt-1 text-[13px] leading-snug text-ink-400">
                {f.texto}
              </p>
            </div>
          ))}
        </section>

        <footer className="mt-24 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-6 text-[12px] text-ink-500">
          <span>{BRAND.name} — beta</span>
          {DOCUMENTOS_LEGAIS.map((d) => (
            <Link
              key={d.slug}
              href={`/${d.slug}`}
              className="hover:text-ink-300"
            >
              {d.titulo}
            </Link>
          ))}
        </footer>
      </div>
    </div>
  );
}
