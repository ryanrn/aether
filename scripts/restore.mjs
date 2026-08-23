/**
 * Restaura um dump gerado pelo `backup.mjs`.
 *
 * Pressupoe a estrutura JA criada (`prisma migrate deploy`): este script
 * devolve DADOS, nao cria tabela.
 *
 * Uso:
 *   npx dotenv -e .env -- node scripts/restore.mjs backups/aether-....json
 *
 * Por seguranca, RECUSA rodar contra um banco que ja tenha dados, a menos que
 * venha `--force`. Restaurar por cima do que esta vivo e como se apaga o que
 * se queria salvar.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { doJson } from "./lib/dump.mjs";

const prisma = new PrismaClient();

/** Insere em lotes: um INSERT por linha faria milhares de idas ao banco. */
const LOTE = 200;

/**
 * Sufixo de conversao por coluna, para os ENUMS.
 *
 * O Postgres NAO converte texto para enum sozinho num INSERT parametrizado:
 * `column "status" is of type "UserStatus" but expression is of type text`.
 * Descoberto pelo teste de ida e volta, nao por leitura de codigo.
 *
 * Convertemos so os enums de proposito. Os demais tipos ja funcionam, e
 * converter tudo "por seguranca" seria adicionar codigo sem falha que o
 * justifique — e um lugar a mais para errar.
 */
async function conversoesDeEnum(prisma, tabela, schema) {
  const colunas = await prisma.$queryRawUnsafe(
    `select column_name, udt_name
       from information_schema.columns
      where table_schema = $1 and table_name = $2
        and data_type = 'USER-DEFINED'`,
    schema,
    tabela,
  );
  return new Map(colunas.map((c) => [c.column_name, `::"${c.udt_name}"`]));
}

export async function restaurar(prisma, dump, { schema = "public" } = {}) {
  if (dump.formato !== 1) {
    throw new Error(
      `formato ${dump.formato} desconhecido — este script entende o 1`,
    );
  }

  let total = 0;
  for (const tabela of dump.ordem) {
    const linhas = dump.dados[tabela] ?? [];
    if (linhas.length === 0) continue;

    const enums = await conversoesDeEnum(prisma, tabela, schema);
    const colunas = Object.keys(linhas[0]);
    const lista = colunas.map((c) => `"${c}"`).join(", ");

    for (let i = 0; i < linhas.length; i += LOTE) {
      const fatia = linhas.slice(i, i + LOTE);
      const valores = [];
      const marcadores = fatia.map((linha) => {
        const grupo = colunas.map((coluna) => {
          valores.push(doJson(linha[coluna]));
          return `$${valores.length}${enums.get(coluna) ?? ""}`;
        });
        return `(${grupo.join(", ")})`;
      });

      await prisma.$executeRawUnsafe(
        `insert into "${schema}"."${tabela}" (${lista}) values ${marcadores.join(", ")}`,
        ...valores,
      );
    }
    total += linhas.length;
    console.log(`  ${String(linhas.length).padStart(6)}  ${tabela}`);
  }
  return total;
}

async function main() {
  const arquivo = process.argv[2];
  if (!arquivo) {
    console.error("uso: node scripts/restore.mjs <arquivo-de-backup.json>");
    process.exitCode = 1;
    return;
  }

  const dump = JSON.parse(readFileSync(arquivo, "utf8"));
  console.log(`restaurando ${arquivo} (de ${dump.criadoEm})\n`);

  // Trava contra o acidente que mais dolorido seria: rodar no banco errado.
  const [{ count }] = await prisma.$queryRawUnsafe(
    `select count(*)::int as count from "public"."User"`,
  );
  if (count > 0 && !process.argv.includes("--force")) {
    console.error(
      `RECUSADO: o banco de destino ja tem ${count} usuario(s).\n` +
        "Restaurar por cima apagaria o que existe. Se e isso mesmo, repita com --force.",
    );
    process.exitCode = 1;
    return;
  }

  const total = await restaurar(prisma, dump);
  console.log(`\n${total} linhas restauradas`);
}

// So roda como script quando chamado direto; o teste importa `restaurar`.
if (process.argv[1] && process.argv[1].endsWith("restore.mjs")) {
  main()
    .catch((erro) => {
      console.error("\nrestauracao FALHOU:", erro.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
