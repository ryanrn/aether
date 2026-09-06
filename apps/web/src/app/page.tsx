import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND, VERSAO_DOS_TERMOS } from "@aether/shared";
import { getSession } from "@/server/auth/session";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { AppMockup } from "@/components/marketing/app-mockup";

export const metadata: Metadata = {
  title: `${BRAND.name} — Voz, tela e texto para quem joga junto`,
  description:
    "Plataforma de voz, compartilhamento de tela e texto com canais persistentes. Beta aberto.",
};

const RECURSOS = [
  {
    titulo: "Reconhece o jogo",
    texto:
      "Lê o que a loja instalou — Steam, Epic, EA, Xbox — e o config do anti-cheat. Aparece na sua atividade sozinho, sem cadastrar executável.",
    icone: (
      <>
        <rect x="2" y="7" width="20" height="10" rx="4" />
        <path d="M7 12h.01M10 12h.01M17 11l1 1-1 1M14.5 12.5l1 1" />
      </>
    ),
  },
  {
    titulo: "Tela sem travar",
    texto:
      "Compartilhamento de tela e câmera na call, com o áudio do sistema junto. Quem assiste ajusta o volume de cada pessoa.",
    icone: (
      <>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>
    ),
  },
  {
    titulo: "Canais que ficam",
    texto:
      "Servidores, cargos e canais de texto e voz. O histórico, os clipes e os fixados continuam ali quando a chamada acaba.",
    icone: <path d="M10 4L8 20M16 4l-2 16M5 9h14M4 15h14" />,
  },
];

const PASSOS = [
  {
    n: "01",
    titulo: "Crie a conta no navegador",
    texto:
      "Confirma o e-mail, entra num servidor por convite ou cria o seu. Funciona direto no navegador.",
  },
  {
    n: "02",
    titulo: "Baixe o app de desktop",
    texto:
      "O app lê as lojas instaladas e mostra o que você está jogando na atividade — sem apontar arquivo na mão.",
  },
  {
    n: "03",
    titulo: "Entre na voz e compartilhe a tela",
    texto:
      "Chamada com tela, câmera e áudio do sistema. O canal de texto guarda o resto.",
  },
];

export default async function IndexPage() {
  const session = await getSession();
  if (session) redirect("/app");

  return (
    <div className="marketing-glow min-h-dvh bg-base-950 text-ink-200">
      <SiteHeader />

      <main>
        {/* ── hero ── */}
        <section className="relative z-[1] border-b border-line">
          <div className="mx-auto grid max-w-[1120px] items-center gap-14 px-6 py-[clamp(64px,9vw,124px)] md:px-8 min-[921px]:grid-cols-[1.12fr_0.88fr]">
            <div>
              <span className="inline-flex items-center gap-2 rounded-pill border border-line bg-white/5 py-[5px] pl-2.5 pr-3 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-400">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-500 shadow-[0_0_10px_1px_color-mix(in_oklch,var(--color-accent-500)_70%,transparent)]" />
                Beta aberto
              </span>
              <h1 className="mt-5 font-brand text-[clamp(37px,4.3vw,54px)] font-semibold leading-[1.06] tracking-[-0.01em] text-ink-100">
                Voz, tela e texto para quem joga junto.
              </h1>
              <p className="mt-5 max-w-[56ch] text-lg leading-relaxed text-ink-300">
                Canais persistentes, chamadas com compartilhamento de tela e um
                app de desktop que reconhece o que você está jogando — sem
                cadastrar executável na mão.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center rounded-md bg-accent-600 px-6 py-3.5 text-[16px] font-medium text-white shadow-[0_8px_24px_-10px_color-mix(in_oklch,var(--color-accent-500)_70%,transparent)] transition-colors hover:bg-accent-700"
                >
                  Criar conta grátis
                </Link>
                <a
                  href={BRAND.downloadUrl}
                  target="_blank"
                  rel="noopener"
                  className="group inline-flex items-center justify-center gap-2 rounded-md px-2.5 py-3.5 text-[16px] font-medium text-ink-100 transition-colors hover:text-accent-400"
                >
                  Baixar para Windows
                  <span className="transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </a>
              </div>
              <p className="mt-4 text-[12.5px] text-ink-400">
                Ao criar uma conta você confirma o e-mail e aceita os{" "}
                <Link
                  href="/termos"
                  className="text-accent-300 underline underline-offset-2"
                >
                  Termos de Uso
                </Link>
                .
              </p>
            </div>

            <AppMockup />
          </div>
        </section>

        {/* ── recursos ── */}
        <section id="recursos" className="relative z-[1] border-b border-line">
          <div className="mx-auto max-w-[1120px] px-6 py-[clamp(56px,8vw,96px)] md:px-8">
            <div className="max-w-[34ch]">
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-ink-400">
                O que muda
              </p>
              <h2 className="mt-5 font-brand text-[clamp(27px,3.2vw,40px)] font-semibold leading-[1.12] tracking-[-0.005em] text-ink-100">
                Três coisas que você nota nos primeiros dez minutos.
              </h2>
            </div>
            <div className="mt-14 grid gap-8 min-[921px]:grid-cols-3">
              {RECURSOS.map((r) => (
                <div key={r.titulo}>
                  <div className="mb-5 grid h-10 w-10 place-items-center rounded-md border border-line bg-base-800 text-ink-100">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {r.icone}
                    </svg>
                  </div>
                  <h3 className="mb-2 font-brand text-xl font-semibold text-ink-100">
                    {r.titulo}
                  </h3>
                  <p className="text-[15px] leading-relaxed text-ink-400">
                    {r.texto}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── como funciona ── */}
        <section
          id="como-funciona"
          className="relative z-[1] border-b border-line"
        >
          <div className="mx-auto grid max-w-[1120px] items-start gap-[clamp(40px,8vw,96px)] px-6 py-[clamp(56px,8vw,96px)] md:px-8 min-[921px]:grid-cols-[5fr_6fr]">
            <div className="min-[921px]:sticky min-[921px]:top-24">
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-ink-400">
                Como funciona
              </p>
              <h2 className="mt-3 font-brand text-[clamp(27px,3.2vw,40px)] font-semibold leading-[1.12] tracking-[-0.005em] text-ink-100">
                Instala, entra e o jogo já aparece.
              </h2>
              <p className="mt-4 max-w-[56ch] text-lg leading-relaxed text-ink-300">
                Do navegador ao app de desktop em três passos — sem configurar
                nada na mão.
              </p>
              <Link
                href="/register"
                className="group mt-6 inline-flex items-center gap-2 text-[15px] font-medium text-ink-100 transition-colors hover:text-accent-400"
              >
                Criar minha conta
                <span className="transition-transform group-hover:translate-x-1">
                  →
                </span>
              </Link>
            </div>
            <ol className="grid">
              {PASSOS.map((p) => (
                <li
                  key={p.n}
                  className="grid grid-cols-[40px_1fr] gap-[18px] border-t border-line py-5 last:border-b"
                >
                  <span className="pt-0.5 font-mono text-[13px] text-ink-400">
                    {p.n}
                  </span>
                  <div>
                    <h3 className="mb-1 font-brand text-xl font-semibold text-ink-100">
                      {p.titulo}
                    </h3>
                    <p className="text-[15px] leading-relaxed text-ink-400">
                      {p.texto}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── privacidade ── */}
        <section id="privacidade" className="relative z-[1] border-b border-line">
          <div className="mx-auto max-w-[760px] px-6 py-[clamp(56px,8vw,96px)] md:px-8">
            <div className="-mb-3 font-brand text-[120px] leading-[0.6] text-accent-500/20">
              “
            </div>
            <blockquote className="max-w-[22ch] font-brand text-[clamp(22px,2.6vw,31px)] font-medium leading-[1.34] tracking-[-0.005em] text-ink-100">
              O conteúdo que você envia continua seu. Não vendemos e não usamos
              para treinar modelos.
            </blockquote>
            <p className="mt-5 font-mono text-[13px] tracking-[0.04em] text-ink-400">
              — Termos de Uso do AETHER, seção 5 · atualizado {VERSAO_DOS_TERMOS}
            </p>
            <p className="mt-8 max-w-[60ch] text-lg leading-relaxed text-ink-300">
              Denúncia pelo menu da mensagem ou do perfil. Conteúdo ilegal é
              removido e reportado às autoridades — sem passar por aviso. O resto
              está escrito na{" "}
              <Link
                href="/conteudo"
                className="text-accent-300 underline underline-offset-2"
              >
                Política de Conteúdo
              </Link>
              .
            </p>
          </div>
        </section>

        {/* ── cta ── */}
        <section className="relative z-[1]">
          <div className="mx-auto max-w-[640px] px-6 py-[clamp(56px,8vw,96px)] text-center md:px-8">
            <h2 className="font-brand text-[clamp(27px,3.2vw,40px)] font-semibold leading-[1.12] tracking-[-0.005em] text-ink-100">
              Entre no beta aberto.
            </h2>
            <p className="mx-auto mt-3.5 max-w-[52ch] text-lg leading-relaxed text-ink-300">
              Qualquer pessoa cria conta agora. Grátis durante o beta, no
              navegador ou no app de desktop.
            </p>
            <Link
              href="/register"
              className="mt-8 inline-flex items-center justify-center rounded-md bg-accent-600 px-6 py-3.5 text-[16px] font-medium text-white shadow-[0_8px_24px_-10px_color-mix(in_oklch,var(--color-accent-500)_70%,transparent)] transition-colors hover:bg-accent-700"
            >
              Criar conta grátis
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
