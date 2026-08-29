/**
 * Gera todos os icones do app a partir de UMA arte.
 *
 * POR QUE UM SCRIPT: o icone vive em tres lugares (app desktop, aba do
 * navegador, atalho do iOS) e cada um quer um tamanho. Trocar a arte a mao
 * significa lembrar dos tres, e o esquecido so aparece muito depois — o
 * favicon antigo continua na aba de quem ja visitou, e ninguem liga o sintoma
 * a troca de logo.
 *
 * A FONTE E VERSIONADA em `assets/marca/icone-fonte.png`, quadrada. Guardar a
 * arte no repositorio evita depender de um arquivo na pasta de downloads de
 * alguem: daqui a seis meses, regerar precisa funcionar sem procurar o
 * original.
 *
 * Uso:
 *   node scripts/gerar-icones.mjs
 *   node scripts/gerar-icones.mjs caminho/para/outra-arte.png
 */
import { mkdirSync, existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import sharp from "sharp";

const FONTE = process.argv[2] ?? "assets/marca/icone-fonte.png";

/**
 * Os destinos.
 *
 * O do desktop fica em 512: a arte tem 758px, entao 512 REDUZ (nitido) em vez
 * de ampliar (borrado). O electron-builder gera o `.ico` do Windows a partir
 * dele, e pede pelo menos 256.
 *
 * Os dois da web seguem a convencao de arquivo do App Router: `icon.png` vira
 * o favicon e `apple-icon.png` vira o atalho do iOS, sem precisar declarar
 * nada no `metadata`.
 */
const DESTINOS = [
  { caminho: "apps/desktop/build/icon.png", tamanho: 512, oque: "app desktop" },
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
  console.log(`Arte: ${FONTE} — ${meta.width}x${meta.height}`);

  if (meta.width !== meta.height) {
    console.log(
      "\nAVISO: a arte NAO e quadrada. Os icones serao deformados ou cortados.\n" +
        "Quadre antes, estendendo o fundo (nao cortando o desenho):\n" +
        `  magick "${FONTE}" -gravity center -background "srgb(8,22,42)" -extent NxN saida.png`,
    );
  }

  for (const { caminho, tamanho, oque } of DESTINOS) {
    mkdirSync(dirname(caminho), { recursive: true });
    await sharp(FONTE)
      .resize(tamanho, tamanho, { fit: "cover" })
      .png({ compressionLevel: 9 })
      .toFile(caminho);
    const kb = Math.round(statSync(caminho).size / 1024);
    console.log(`  ok  ${caminho.padEnd(34)} ${tamanho}px  ${kb}KB  (${oque})`);
  }

  console.log(
    "\nO favicon e o do desktop ja valem no proximo build.\n" +
      "Para o icone chegar em quem JA INSTALOU o app, precisa de uma versao nova:\n" +
      "  o instalador carrega o icone, entao so um release novo o substitui.",
  );
}

main().catch((erro) => {
  console.error("erro:", erro.message);
  process.exitCode = 1;
});
