import type { Metadata, Viewport } from "next";
import { Chakra_Petch, JetBrains_Mono, Rubik } from "next/font/google";
import { BRAND } from "@aether/shared";
import "./globals.css";

/**
 * Tipografia.
 *
 * Rubik na interface, e nao uma fonte de display: este app tem CENTO E
 * SESSENTA usos de texto entre 10px e 13px — arvore de canais, lista de
 * membros, cartao de atividade. Fonte angular do tipo "esports" fica linda num
 * titulo e cansa em 160 lugares pequenos. Rubik e geometrica e moderna, mas
 * desenhada para ser lida miuda.
 *
 * Saiu do Inter porque Inter e a fonte padrao de todo mundo — correta e sem
 * identidade nenhuma.
 */
const rubik = Rubik({
  subsets: ["latin"],
  variable: "--font-sans-ui",
  display: "swap",
});

/**
 * O caractere "gamer" mora AQUI, na marca — que aparece grande e em dois
 * lugares. Custo zero de legibilidade, e e onde a identidade e vista.
 */
const chakra = Chakra_Petch({
  subsets: ["latin"],
  /**
   * Nome DIFERENTE do token `--font-brand` do tema, de proposito. Com o mesmo
   * nome nos dois lados, o `@theme` vira `--font-brand: var(--font-brand)` —
   * referencia circular, que o navegador descarta em silencio.
   */
  variable: "--font-brand-face",
  display: "swap",
  weight: ["600", "700"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-jet",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.description,
};

export const viewport: Viewport = {
  themeColor: "#06070a",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      className={`${rubik.variable} ${chakra.variable} ${jetbrains.variable}`}
    >
      <body className="min-h-dvh bg-base-950 text-ink-200 antialiased">
        {children}
      </body>
    </html>
  );
}
