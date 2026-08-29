/**
 * Gera todos os icones do app a partir de UMA arte.
 *
 * POR QUE UM SCRIPT: o icone vive em tres lugares (app desktop, aba do
 * navegador, atalho do iOS) e cada um quer um tamanho. Trocar a arte a mao
 * significa lembrar dos tres, e o esquecido so aparece muito depois — o
 * favicon antigo continua na aba de quem ja visitou, e ninguem liga o sintoma
 * a troca de logo.
 *
 * A FONTE E VERSIONADA em `assets/marca/icone.png` — quadrada, 1024px e com
 * FUNDO TRANSPARENTE. Guardar a arte no repositorio evita depender de um
 * arquivo na pasta de downloads de alguem: daqui a seis meses, regerar precisa
 * funcionar sem procurar o original.
 *
 * POR QUE TRANSPARENTE: a primeira versao carregava o fundo azul-escuro da
 * arte, e na barra do Windows isso vira um retangulo escuro visivel entre
 * icones que nao tem fundo nenhum. Fundo proprio so funciona quando todos tem.
 *
 * A arte original (com fundo) fica em `icone-fonte.png`. O recorte usou o
 * proprio BRILHO como transparencia — o que preserva o halo azul, em vez de
 * deixar franja escura em volta como faria remover uma cor:
 *
 *   magick assets/marca/icone-fonte.png \
 *     \( +clone -colorspace gray -level 14%,38% \) \
 *     -alpha off -compose CopyOpacity -composite \
 *     -trim +repage \
 *     -resize 900x900 -background none -gravity center -extent 1024x1024 \
 *     assets/marca/icone.png
 *
 * O `14%,38%` saiu de comparar tres ajustes sobre fundo claro e escuro: mais
 * aberto deixava um halo cinzento no claro, mais fechado comia o brilho e
 * endurecia a borda. O `-trim` seguido de `-extent` da a margem que impede o
 * icone de encostar nos vizinhos da barra.
 *
 * Uso:
 *   node scripts/gerar-icones.mjs
 *   node scripts/gerar-icones.mjs caminho/para/outra-arte.png
 */
import { mkdirSync, existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import sharp from "sharp";

const FONTE = process.argv[2] ?? "assets/marca/icone.png";

/**
 * O `.ico` do Windows. Gerado logo abaixo, por ImageMagick, e versionado — e
 * NAO deixado a cargo do electron-builder, que morre de falta de memoria numa
 * maquina ocupada.
 */
const DESTINO_ICO = "apps/desktop/build/icon.ico";

/**
 * Os destinos em PNG.
 *
 * O do desktop fica como FONTE do `.ico` e como fallback; o electron-builder
 * aponta para o `.ico`.
 *
 * Os dois da web seguem a convencao de arquivo do App Router: `icon.png` vira
 * o favicon e `apple-icon.png` vira o atalho do iOS, sem precisar declarar
 * nada no `metadata`.
 */
const DESTINOS = [
  { caminho: "apps/desktop/build/icon.png", tamanho: 512, oque: "app desktop (fonte)" },
  { caminho: "apps/web/src/app/icon.png", tamanho: 512, oque: "aba do navegador" },
  { caminho: "apps/web/src/app/apple-icon.png", tamanho: 180, oque: "atalho no iOS" },
];

async function main() {
  if (!existsSync(FONTE)) {
    console.log(`Nao encontrei a arte em ${FONTE}`);
    process.exitCode = 1;
    return;
  }

  const meta = await sharp(FONTE).metadata();
  console.log(`Arte: ${FONTE} — ${meta.width}x${meta.height}, alfa: ${meta.hasAlpha}`);

  if (!meta.hasAlpha) {
    console.log(
      "\nAVISO: a arte nao tem canal alfa. O icone vai carregar um retangulo de\n" +
        "fundo, que na barra do Windows aparece como uma caixa entre icones sem\n" +
        "fundo. O cabecalho deste arquivo tem o comando de recorte.",
    );
  }

  if (meta.width !== meta.height) {
    console.log(
      "\nAVISO: a arte NAO e quadrada. Os icones sairao deformados ou cortados.\n" +
        "Quadre antes estendendo o fundo, e nao cortando o desenho.",
    );
  }

  for (const { caminho, tamanho, oque } of DESTINOS) {
    mkdirSync(dirname(caminho), { recursive: true });
    await sharp(FONTE)
      /*
       * `contain` sobre fundo transparente, e nao `cover`: a arte ja vem
       * quadrada e com respiro proprio, e `cover` cortaria justamente a margem
       * que existe para o icone nao encostar nos vizinhos.
       */
      .resize(tamanho, tamanho, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toFile(caminho);
    const kb = Math.round(statSync(caminho).size / 1024);
    console.log(`  ok  ${caminho.padEnd(34)} ${tamanho}px  ${kb}KB  (${oque})`);
  }

  /**
   * O `.ico` do Windows, gerado AQUI e versionado.
   *
   * O electron-builder sabe converter PNG para ICO sozinho, mas para isso sobe
   * um Node dedicado que precisa de memoria contigua para desserializar o V8.
   * Numa maquina ocupada ele morre com "Fatal JavaScript out of memory" e
   * derruba o build inteiro por causa de um icone — aconteceu, com 3,9 GB
   * livres de 16. Entregando o arquivo pronto, esse passo deixa de existir.
   *
   * Precisa do ImageMagick. Sem ele o script AVISA em vez de falhar calado: o
   * `.ico` versionado continua valendo ate alguem trocar a arte.
   */
  try {
    const { execFileSync } = await import("node:child_process");
    execFileSync(
      "magick",
      [
        FONTE,
        "-define",
        "icon:auto-resize=256,128,64,48,32,24,16",
        DESTINO_ICO,
      ],
      { stdio: "pipe" },
    );
    const kb = Math.round(statSync(DESTINO_ICO).size / 1024);
    console.log(`  ok  ${DESTINO_ICO.padEnd(34)} 7 tamanhos  ${kb}KB  (Windows)`);
  } catch {
    console.log(
      `\n  --  ${DESTINO_ICO} NAO foi regerado (falta ImageMagick no PATH).\n` +
        "      O arquivo versionado continua valendo. Se voce trocou a arte,\n" +
        "      regere antes de publicar:\n" +
        `      magick ${FONTE} -define icon:auto-resize=256,128,64,48,32,24,16 ${DESTINO_ICO}`,
    );
  }

  console.log(
    "\nO favicon vale no proximo deploy da web.\n" +
      "Para o icone chegar em quem JA INSTALOU o desktop, precisa de uma versao\n" +
      "nova: o instalador carrega o icone, entao so um release novo o substitui.",
  );
}

main().catch((erro) => {
  console.error("erro:", erro.message);
  process.exitCode = 1;
});
