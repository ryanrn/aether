import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { BRAND } from "@aether/shared";
import "./globals.css";
import { TitleBar } from "@/components/layout/title-bar";
import { NovidadesModal } from "@/components/layout/novidades-modal";
import { DeepLinkListener } from "@/components/realtime/deep-link-listener";
import { RealtimeRoot } from "@/components/realtime/realtime-root";
import { AetherIconSprite } from "@/components/ui/aether-icon";
import { SCRIPT_APARENCIA } from "@/components/ui/aparencia";

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
 *
 * ARQUIVOS LOCAIS (`./fonts`), e nao `next/font/google`. Este baixava as fontes
 * do Google a cada build, e em 01/11/2026 o Google passou a devolver, as vezes,
 * uma resposta que o carregador do Next nao entende: o build quebrava no CI e na
 * Vercel sem nada ter mudado no codigo. Os `.woff2` sao os mesmos que o Google
 * servia (subconjunto `latin`), com as licencas OFL ao lado. Para trocar de
 * versao, baixe de novo do Google Fonts e substitua os arquivos.
 */
const rubik = localFont({
  src: "./fonts/rubik-variable-latin.woff2",
  weight: "300 900",
  variable: "--font-sans-ui",
  display: "swap",
});

/**
 * O caractere "gamer" mora AQUI, na marca — que aparece grande e em dois
 * lugares. Custo zero de legibilidade, e e onde a identidade e vista.
 */
const chakra = localFont({
  src: [
    { path: "./fonts/chakra-petch-600-latin.woff2", weight: "600" },
    { path: "./fonts/chakra-petch-700-latin.woff2", weight: "700" },
  ],
  /**
   * Nome DIFERENTE do token `--font-brand` do tema, de proposito. Com o mesmo
   * nome nos dois lados, o `@theme` vira `--font-brand: var(--font-brand)` —
   * referencia circular, que o navegador descarta em silencio.
   */
  variable: "--font-brand-face",
  display: "swap",
});

/** Arquivo variavel: o mesmo cobre os pesos 400 e 500 que o app usa. */
const jetbrains = localFont({
  src: "./fonts/jetbrains-mono-variable-latin.woff2",
  weight: "400 500",
  variable: "--font-mono-jet",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.description,
};

export const viewport: Viewport = {
  themeColor: "#0b0d10",
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
      /*
        O script sem-flash escreve `--app-scale` e `data-*` no <html> antes da
        hidratacao, entao o que o servidor mandou (sem esses atributos) nao bate
        com o cliente. `suppressHydrationWarning` cobre exatamente este caso —
        so este elemento, um nivel — e e o padrao para script de tema.
      */
      suppressHydrationWarning
    >
      <head>
        {/*
          Escala/contraste/movimento aplicados ANTES da primeira pintura, senao
          a interface piscaria na escala 1 e saltaria para a escolhida. Le o
          mesmo `localStorage` que o `usePrefsDoChat`.
        */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_APARENCIA }} />
      </head>
      {/*
        Coluna de altura fixa: a barra de titulo em cima, o resto embaixo.
        `h-dvh` no lugar de `min-h-dvh` porque o conteudo abaixo precisa de uma
        altura DEFINIDA para dividir — as telas do app usam `h-full` e, sem um
        pai medido, elas colapsariam.
      */}
      <body className="flex h-dvh flex-col overflow-hidden bg-base-950 text-ink-200 antialiased">
        {/* Sprite de icones do AETHER — inline uma vez, cobre o app inteiro. */}
        <AetherIconSprite />
        <DeepLinkListener />
        <TitleBar />
        {/*
          `overflow-auto` aqui serve as telas curtas (entrar, criar conta) em
          janelas baixas. As telas do app tem rolagem propria por dentro e nao
          chegam a usar esta.
        */}
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          {/*
            A conexao em tempo real e a sessao de voz moram AQUI, no unico
            ponto que o App Router nao remonta ao navegar dentro de `/app`.
            `RealtimeRoot` so as liga quando a rota e `/app*`.
          */}
          <RealtimeRoot>{children}</RealtimeRoot>
        </div>
        {/*
          "Veja o que mudou", no primeiro boot depois de uma atualizacao.
          Fica no layout raiz e nao dentro de /app porque a atualizacao pode
          terminar com a pessoa na tela de entrar. So aparece no aplicativo de
          desktop; no navegador nao ha versao instalada com que comparar.
        */}
        <NovidadesModal />
      </body>
    </html>
  );
}
