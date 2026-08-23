/**
 * Backup dos DADOS do banco.
 *
 * De dados, e nao de schema, de proposito: a estrutura ja esta versionada em
 * `packages/db/prisma/migrations`. Duplicar isso num dump criaria duas
 * verdades sobre a mesma coisa, e no dia de restaurar ninguem saberia qual
 * seguir. O caminho de volta e:
 *
 *   1. `prisma migrate deploy`  -> recria a estrutura a partir do git
 *   2. `node scripts/restore.mjs <arquivo>` -> devolve os dados
 *
 * NAO cobre o Supabase Storage (fotos de perfil e icones de servidor). Aquilo
 * vive fora do banco, e esta anotado nas limitacoes do README.
 *
 * Uso:
 *   npx dotenv -e .env -- node scripts/backup.mjs
 */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { lerTabela, tabelasEmOrdem } from "./lib/dump.mjs";

const prisma = new PrismaClient();
const DESTINO = process.env.BACKUP_DIR ?? "backups";

async function main() {
  const ordem = await tabelasEmOrdem(prisma);
  const dados = {};
  let total = 0;

  console.log("lendo tabelas (pai antes de filho):\n");
  for (const tabela of ordem) {
    const linhas = await lerTabela(prisma, tabela);
    dados[tabela] = linhas;
    total += linhas.length;
    console.log(`  ${String(linhas.length).padStart(6)}  ${tabela}`);
  }

  const dump = {
    /**
     * Versao do formato. Existe para o restore recusar um arquivo que nao
     * entende, em vez de gravar lixo com confianca.
     */
    formato: 1,
    criadoEm: new Date().toISOString(),
    // A ordem viaja junto: quem restaura nao depende de recalcular contra um
    // banco que pode estar vazio (sem tabelas, nao ha FK para derivar ordem).
    ordem,
    dados,
  };

  mkdirSync(DESTINO, { recursive: true });
  const carimbo = dump.criadoEm.replace(/[:.]/g, "-");
  const arquivo = path.join(DESTINO, `aether-${carimbo}.json`);
  writeFileSync(arquivo, JSON.stringify(dump), "utf8");

  const tamanho = (Buffer.byteLength(JSON.stringify(dump)) / 1024).toFixed(0);
  console.log(`\n${total} linhas em ${ordem.length} tabelas`);
  console.log(`gravado: ${arquivo} (${tamanho} KB)`);
}

main()
  .catch((erro) => {
    console.error("\nbackup FALHOU:", erro.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
