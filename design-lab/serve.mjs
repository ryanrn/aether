/**
 * Servidor do laboratorio de design.
 *
 * Porta 5174, separada de tudo: o app web fica na 3000, o gateway na 4000 e o
 * site na 5173. Nada aqui toca o app — e um HTML solto para OLHAR e decidir,
 * antes de mexer no que ja funciona.
 *
 * Uso:  node design-lab/serve.mjs
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT ?? 5174);

createServer((req, res) => {
  const arquivo = req.url === "/" || !req.url ? "index.html" : req.url.slice(1);
  try {
    // Le a cada pedido, sem cache: recarregar a pagina ja mostra a ultima edicao.
    const corpo = readFileSync(path.join(AQUI, arquivo.split("?")[0]));
    res.writeHead(200, {
      "content-type": arquivo.endsWith(".html")
        ? "text/html; charset=utf-8"
        : "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(corpo);
  } catch {
    res.writeHead(404).end("nao encontrado");
  }
}).listen(PORTA, () => {
  console.log(`laboratorio de design em http://localhost:${PORTA}`);
});
