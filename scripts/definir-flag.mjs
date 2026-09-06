/**
 * Vira um kill switch pela linha de comando.
 *
 * A tela da equipe (`/app/equipe` › Kill switches) e o caminho normal. Este
 * script existe para o caso em que a tela nao esta acessivel — o proprio web
 * fora do ar, ou um incidente as 3h da manha em que e mais rapido um comando.
 *
 * As chaves conhecidas e seus padroes vivem em `@aether/shared/flags`. Este
 * script nao valida contra elas de proposito: se voce precisa criar uma chave
 * nova as pressas, ele deixa — o codigo que le `flagLigada` so entende as
 * conhecidas, entao uma chave desconhecida no banco simplesmente e ignorada.
 *
 * Uso:
 *   npx dotenv -e .env -- node scripts/definir-flag.mjs --listar
 *   npx dotenv -e .env -- node scripts/definir-flag.mjs registro_aberto off
 *   npx dotenv -e .env -- node scripts/definir-flag.mjs registro_aberto on
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const LIGADO = new Set(["on", "sim", "true", "1", "ligado"]);
const DESLIGADO = new Set(["off", "nao", "false", "0", "desligado"]);

async function listar() {
  const linhas = await prisma.flag.findMany({ orderBy: { chave: "asc" } });
  if (linhas.length === 0) {
    console.log("Nenhuma flag no banco — tudo no padrao do codigo.");
    return;
  }
  console.log(`Flags no banco (${linhas.length}):`);
  for (const f of linhas) {
    const quando = f.atualizadoEm.toISOString().slice(0, 16).replace("T", " ");
    console.log(
      `   ${f.ligado ? "ON " : "OFF"}  ${f.chave.padEnd(24)}  ${quando}` +
        (f.atualizadoPor ? `  por ${f.atualizadoPor}` : ""),
    );
  }
}

async function main() {
  if (process.argv.includes("--listar")) return listar();

  const chave = process.argv[2];
  const estado = (process.argv[3] ?? "").toLowerCase();

  if (!chave || (!LIGADO.has(estado) && !DESLIGADO.has(estado))) {
    console.error(
      "Uso: definir-flag.mjs <chave> <on|off>  |  definir-flag.mjs --listar",
    );
    process.exit(1);
  }

  const ligado = LIGADO.has(estado);
  await prisma.flag.upsert({
    where: { chave },
    create: { chave, ligado, atualizadoPor: "script" },
    update: { ligado, atualizadoPor: "script" },
  });

  console.log(`${chave} -> ${ligado ? "ON" : "OFF"}`);
  console.log("Leva ate ~5s para valer em cada processo (cache curto).");
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
