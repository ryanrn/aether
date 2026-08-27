/**
 * Monta o worklet de supressao de ruido num arquivo so.
 *
 * POR QUE PRECISA DE BUILD. `audioWorklet.addModule` carrega um script
 * CLASSICO, e o escopo do worklet nao tem `import`, `fetch` nem
 * `import.meta` — o modulo do RNNoise, que e ESM e se refere a
 * `import.meta.url`, nao carrega la dentro de jeito nenhum. A saida tem que
 * ser um bundle autocontido, com o WASM embutido.
 *
 * A saida vai para `public/` e E VERSIONADA: assim `npm run dev` funciona sem
 * ninguem lembrar de rodar isto, e a Vercel nao precisa de passo extra. Rode
 * de novo (`npm run build:worklet`) se o processador ou o pacote mudarem.
 */
import { build } from "esbuild";
import { statSync } from "node:fs";

const SAIDA = "apps/web/public/rnnoise-worklet.js";

await build({
  entryPoints: ["apps/web/worklets/rnnoise-processor.js"],
  outfile: SAIDA,
  bundle: true,
  minify: true,
  /**
   * `iife` e nao `esm`: o worklet nao aceita modulo. E `target` alto porque
   * quem executa isto e a thread de audio de um navegador atual — nao ha
   * ganho em transpilar para tras.
   */
  format: "iife",
  target: "es2022",
  define: {
    /**
     * O pacote le `import.meta.url` para achar o `.wasm` — mas a versao
     * `sync` embute o binario e nunca usa o valor. Definir como string vazia
     * e o que permite empacotar em `iife`, onde `import.meta` nem existe.
     */
    "import.meta.url": '""',
  },
  logLevel: "warning",
});

const tamanho = statSync(SAIDA).size;
console.log(`${SAIDA} — ${(tamanho / 1024).toFixed(0)} KB`);

/**
 * Um teto de sanidade. Se o bundle disparar de tamanho, alguem trocou a
 * versao `sync` (WASM embutido) pela assincrona, ou arrastou meio app para
 * dentro do worklet sem querer — os dois quebram em producao de formas
 * dificeis de ligar a esta mudanca.
 */
if (tamanho > 3 * 1024 * 1024) {
  console.error("Bundle do worklet grande demais; confira o que entrou.");
  process.exit(1);
}
