/**
 * Copia os SVGs do Twemoji para `public/`, servidos de 'self'.
 *
 * POR QUE SELF-HOSTED. A CSP deste app so libera imagem de 'self', Supabase,
 * R2, IGDB e Spotify — nada de CDN de emoji. Hotlinkar `twemoji.maxcdn.com` ou
 * `jsdelivr` deixaria o emoji quebrado em producao e funcionando no dev, que e
 * o pior jeito de errar. Sao ~3700 arquivos de 1–2 KB, buscados sob demanda
 * pelo navegador (so entra no cache o emoji que aparece de fato) — nada disso
 * pesa no bundle de JS.
 *
 * A saida (`public/twemoji/`) NAO e versionada — sao 3700 arquivos e o git
 * fica lento a toa. Em vez disso roda no `predev` e no `prebuild` do
 * `apps/web`, entao `npm run dev` e a Vercel a geram sozinhas. E idempotente:
 * so copia se a pasta ainda nao estiver completa (use `--force` para refazer).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const origem = dirname(require.resolve("@twemoji/svg/package.json"));
/**
 * Caminho ANCORADO na raiz do repo (`scripts/..`), nao no `cwd`: o npm roda
 * este script com `cwd` no workspace (`apps/web`) quando ele e `prebuild`, e um
 * caminho relativo cairia em `apps/web/apps/web/public`.
 */
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const destino = join(raiz, "apps/web/public/twemoji");

const svgs = readdirSync(origem).filter((n) => n.endsWith(".svg"));
if (svgs.length < 1000) {
  console.error(
    `@twemoji/svg tem so ${svgs.length} arquivos — pacote incompleto?`,
  );
  process.exit(1);
}

const forcar = process.argv.includes("--force");
if (!forcar && existsSync(destino)) {
  const jaTem = readdirSync(destino).filter((n) => n.endsWith(".svg")).length;
  if (jaTem >= svgs.length) {
    console.log(`twemoji: ${jaTem} SVGs ja em ${destino} — nada a fazer`);
    process.exit(0);
  }
}

if (existsSync(destino)) rmSync(destino, { recursive: true });
mkdirSync(destino, { recursive: true });

for (const nome of svgs) {
  cpSync(join(origem, nome), join(destino, nome));
}

console.log(`twemoji: ${svgs.length} SVGs -> ${destino}`);
