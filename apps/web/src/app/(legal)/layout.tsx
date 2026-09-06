import { VERSAO_DOS_TERMOS } from "@aether/shared";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";

/**
 * Casca das paginas legais (`/termos`, `/privacidade`, `/conteudo`).
 *
 * Releitura OpenDesign: topnav fixa, cabecalho de documento (eyebrow + titulo
 * + lede) e a grade `[TOC | prose]` ficam DENTRO de cada pagina — aqui mora so
 * o header, o fundo com halo, o rodape e a nota de versao.
 */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="marketing-glow min-h-dvh bg-base-950 text-ink-200">
      <SiteHeader compact />
      <main className="relative z-[1]">{children}</main>
      <div className="relative z-[1] border-t border-line">
        <div className="mx-auto max-w-[1120px] px-6 py-4 md:px-8">
          <p className="font-mono text-[11px] text-ink-500">
            Versão {VERSAO_DOS_TERMOS}. Documento inicial de um produto em beta;
            será revisado por um profissional jurídico antes do lançamento
            público.
          </p>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
