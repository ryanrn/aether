import type { NextConfig } from "next";

const emDev = process.env.NODE_ENV !== "production";

/**
 * Origem de uma URL de configuracao, sem caminho e sem barra final.
 *
 * Devolve `null` em vez de lancar: uma variavel ausente nao pode derrubar o
 * build. O custo de errar para o outro lado esta comentado no CSP abaixo.
 */
function origem(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * A mesma origem nos DOIS esquemas — `https` e `wss`.
 *
 * Precisa aceitar entrada em qualquer um dos dois porque as variaveis nao
 * seguem a mesma convencao: `NEXT_PUBLIC_REALTIME_URL` vem como `https://`,
 * `LIVEKIT_URL` vem como `wss://`. A primeira versao so convertia http->ws e
 * gerou uma politica com `wss://` duplicado e SEM o `https://` do LiveKit —
 * que e por onde o SDK descobre a regiao antes de abrir o socket. O CSP saiu
 * do jeito que so quebraria a call em producao, calado.
 *
 * `wss` e `ws` + `s`, entao trocar o prefixo `ws` por `http` acerta os dois
 * casos de uma vez.
 */
function origensDe(url: string | undefined): string[] {
  const base = origem(url);
  if (!base) return [];
  const viaHttp = base.replace(/^ws/, "http");
  const viaSocket = viaHttp.replace(/^http/, "ws");
  return [...new Set([viaHttp, viaSocket])];
}

/**
 * Falta variavel de origem em build de producao: erro de build, nao aviso.
 *
 * Uma politica com origem faltando nao avisa nada — ela simplesmente bloqueia
 * o websocket ou a imagem no navegador de quem usa. Trocar isso por um build
 * que para com o nome da variavel na tela e o unico modo de falha aceitavel
 * aqui. Em desenvolvimento nao vale: `NEXT_PUBLIC_REALTIME_URL` fica comentado
 * no `.env` de propOsito, e o cliente cai no localhost padrao.
 */
function exigirEmProducao(origens: string[], variavel: string): string[] {
  if (origens.length === 0 && process.env.NODE_ENV === "production") {
    throw new Error(
      `${variavel} nao esta definida: o Content-Security-Policy sairia sem essa origem e o recurso seria bloqueado em producao.`,
    );
  }
  return origens;
}

/**
 * Content-Security-Policy.
 *
 * ATE AQUI NAO HAVIA NENHUMA. Os quatro cabecalhos que ja existiam cobrem
 * sniffing, enquadramento e referer; nenhum deles diz PARA ONDE a pagina pode
 * falar. Essa e a lacuna que mais importa aqui: se um dia entrar script de
 * terceiro no bundle — dependencia comprometida, um `dangerouslySetInnerHTML`
 * adicionado sem pensar — nada impede o script de mandar sessao, mensagem ou
 * token de midia para um host qualquer. `connect-src` impede.
 *
 * SOBRE `'unsafe-inline'` EM script-src: e uma concessao real e vale dizer o
 * tamanho dela. O App Router injeta script inline com os dados de hidratacao
 * em toda pagina; tirar isso exige nonce via middleware, e nonce forca
 * renderizacao dinamica em TODA rota. Com `'unsafe-inline'`, o CSP nao protege
 * contra XSS de script — o que protege hoje e o React escapar por padrao e nao
 * existir `dangerouslySetInnerHTML` em lugar nenhum do app (verificado).
 *
 * O que a politica entrega mesmo assim, e nao e pouco:
 *   - `connect-src` fecha a exfiltracao, que e o passo que transforma XSS em
 *     vazamento;
 *   - `base-uri` impede injecao de `<base>`, que reescreve todo caminho
 *     relativo da pagina de uma vez;
 *   - `form-action` impede que um formulario poste para fora;
 *   - `object-src 'none'` mata plugin legado;
 *   - `frame-ancestors` repete o X-Frame-Options no unico mecanismo que
 *     navegador moderno respeita.
 *
 * AS ORIGENS SAO DERIVADAS DO AMBIENTE, nao escritas a mao: host fixo aqui
 * envelhece calado, e CSP desatualizada nao avisa que esta errada — ela
 * simplesmente bloqueia a imagem, o websocket ou a call, em producao, sem erro
 * de build. Se a variavel faltar, a origem some da lista e o recurso e
 * bloqueado; por isso `origem()` devolve `null` e o item nao entra em vez de
 * virar string vazia, que valeria "qualquer coisa" em algumas leituras.
 */
/**
 * O padrao localhost SO em desenvolvimento — e essa distincao e o ponto.
 *
 * A primeira versao aplicava `?? "http://localhost:4000"` sempre, o que
 * anulava a guarda logo abaixo: com fallback, `origensDe` nunca volta vazio e
 * `exigirEmProducao` nunca dispara. Faltando a variavel na Vercel, o build
 * passaria e a politica sairia liberando `localhost:4000` — bloqueando o
 * gateway de verdade, em producao, sem uma linha de erro em lugar nenhum.
 *
 * O mesmo padrao existe no cliente (`realtime-provider.tsx`), e la o fallback
 * e inofensivo: no maximo o socket nao conecta e a tela mostra desconectado.
 * Aqui ele mentia sobre a politica de seguranca.
 */
const gateway = exigirEmProducao(
  origensDe(
    process.env.NEXT_PUBLIC_REALTIME_URL ??
      (emDev ? "http://localhost:4000" : undefined),
  ),
  "NEXT_PUBLIC_REALTIME_URL",
);
/**
 * O LiveKit entra por CURINGA, e nao derivado de variavel — de proposito.
 *
 * `LIVEKIT_URL` nao existe na Vercel, e nao e esquecimento: quem emite o token
 * do SFU e o gateway no Fly, e a URL chega ao navegador dentro da resposta do
 * `voice:join`. O app web nunca precisou dela. Derivar a politica dessa
 * variavel — como a primeira versao fazia — quebraria o build da Vercel, e a
 * "correcao" obvia (duplicar a variavel na Vercel) criaria duas copias de uma
 * configuracao que precisa bater: quando divergissem, a call morreria em
 * producao sem erro nenhum.
 *
 * O custo do curinga e admitir qualquer projeto do LiveKit Cloud, nao so o
 * nosso. Como canal de exfiltracao isso e ruim para o atacante: seria preciso
 * controlar um projeto LiveKit e conseguir escrever dados por um handshake de
 * sala. O ganho — uma politica que nao depende de duas configuracoes
 * concordarem — vale mais.
 */
const livekit = ["https://*.livekit.cloud", "wss://*.livekit.cloud"];
const supabase = origem(process.env.SUPABASE_URL);

/**
 * O R2 aparece em DOIS lugares da politica, por dois motivos diferentes.
 *
 *  - `r2Envio` e o endpoint S3, para onde o navegador faz PUT do anexo. Vai em
 *    `connect-src`. Sem ele o upload morre com "falha de rede" e nenhum
 *    status — o navegador bloqueia antes de a requisicao sair, e o erro nao
 *    diz que foi CSP.
 *  - `r2Leitura` e a URL publica de onde a imagem e o video sao BAIXADOS. Vai
 *    em `img-src` e `media-src`.
 *
 * Sao hosts diferentes (`*.r2.cloudflarestorage.com` contra `pub-*.r2.dev` ou
 * dominio proprio), entao um so nao serve para os dois.
 *
 * Derivados do ambiente como todo o resto: host fixo aqui envelhece calado, e
 * CSP desatualizada nao avisa que esta errada — ela so bloqueia.
 */
const r2Envio = process.env.R2_ACCOUNT_ID
  ? [
      /**
       * DUAS FORMAS DO MESMO ENDERECO, e as duas precisam estar aqui.
       *
       * O SDK da AWS enderecα no estilo "virtual-hosted": o nome do bucket vai
       * no HOSTNAME, virando `<bucket>.<conta>.r2.cloudflarestorage.com`.
       * Liberar so `<conta>.r2...` deixa o navegador bloquear o PUT — e o
       * sintoma e "falha de rede" com status 0, que nao diz que foi o CSP.
       *
       * A forma sem bucket fica junto porque o estilo de enderecamento e
       * escolha do SDK e pode mudar de versao. Listar as duas custa uma linha
       * e evita que uma atualizacao de dependencia derrube o envio em
       * producao, calada.
       */
      `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      process.env.R2_BUCKET
        ? `https://${process.env.R2_BUCKET}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
        : null,
    ].filter(Boolean)
  : [];
const r2Leitura = origem(process.env.R2_PUBLIC_URL);

const csp = [
  "default-src 'self'",

  /**
   * `'unsafe-eval'` SO em desenvolvimento: o Fast Refresh do Next avalia
   * codigo em tempo de execucao. Em producao nao entra — e a linha existe
   * separada justamente para nao virar permanente por descuido.
   */
  /**
   * `'wasm-unsafe-eval'` libera COMPILAR WebAssembly, e nada alem disso.
   *
   * Existe pela supressao de ruido: o RNNoise e um modulo WASM, e sem esta
   * diretiva o Chrome recusa com
   * "Compiling or instantiating WebAssembly module violates the following
   * Content Security policy directive" — medido em producao antes de escrever
   * o recurso.
   *
   * E MUITO mais estreito que `'unsafe-eval'`: nao permite `eval()`,
   * `new Function()` nem `setTimeout("string")`. O que ele abre e a
   * possibilidade de rodar um binario WASM, e o unico que carregamos e o que
   * empacotamos nos mesmos, do proprio bundle — nao ha origem externa em
   * `script-src` por onde entrar outro.
   */
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${emDev ? " 'unsafe-eval'" : ""}`,

  // Tailwind e o Next emitem style inline; sem isto a pagina vem sem estilo.
  "style-src 'self' 'unsafe-inline'",

  /**
   * `data:` para os icones de jogo, que chegam como data URL do detector.
   * `blob:` para preview de imagem antes do upload. Hosts remotos: capa de
   * jogo (IGDB), icone de servidor (Supabase Storage), capa de album do
   * Spotify (`i.scdn.co`).
   */
  [
    "img-src 'self' data: blob:",
    supabase,
    r2Leitura,
    "https://images.igdb.com",
    "https://i.scdn.co",
  ]
    .filter(Boolean)
    .join(" "),

  // `next/font/google` baixa a fonte no build e serve de /_next — nada externo.
  "font-src 'self' data:",

  // Tela e camera chegam como MediaStream; o worklet de audio vem de /public.
  /**
   * Video e audio anexados sao baixados do R2, entao a leitura entra aqui
   * tambem — nao so em `img-src`.
   */
  ["media-src 'self' blob:", r2Leitura].filter(Boolean).join(" "),
  "worker-src 'self' blob:",

  /**
   * A lista curta que importa: propria origem, gateway e SFU. Nada mais.
   * O upload para o Supabase passa pelo servidor (server-only), entao o
   * navegador nunca fala com o Storage — so le imagem, que e `img-src`.
   */
  ["connect-src 'self'", ...gateway, ...livekit, ...r2Envio]
    .filter(Boolean)
    .join(" "),

  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const config: NextConfig = {
  reactStrictMode: true,
  // Os pacotes do workspace sao consumidos como fonte TypeScript.
  transpilePackages: ["@aether/shared", "@aether/db", "@aether/access"],
  // Prisma nao pode ser empacotado pelo bundler do servidor.
  serverExternalPackages: ["@prisma/client"],
  experimental: {
    // Server actions so aceitam requisicoes da propria origem.
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            /**
             * `(self)` no que o app USA; `()` no que ele nao usa.
             *
             * A camera saiu de `()` para `(self)` quando o recurso passou a
             * existir. Vale registrar o modo de falha, porque foi caro: com
             * `camera=()` o navegador nega ANTES de qualquer permissao — o
             * handler do Electron respondia "pode", o Windows permitia, a
             * webcam estava livre, e mesmo assim vinha
             * `NotAllowedError: Permission denied`. Sem cabecalho nenhum
             * (`file://`) a mesma camera abria na hora.
             *
             * `geolocation` continua trancada: o app nao usa, e permissao que
             * nao se usa e superficie de ataque de graca.
             */
            value:
              "camera=(self), microphone=(self), display-capture=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default config;
