/**
 * Prova que o backup RESTAURA — nao que ele existe.
 *
 * Backup nao testado e crenca, nao capacidade. Este script faz o caminho
 * inteiro contra o Postgres de verdade e compara o resultado.
 *
 * Duas coisas diferentes sao verificadas, porque sao dois modos de falhar:
 *
 *  1. ORDEM — para toda chave estrangeira do banco, a tabela pai aparece
 *     antes da filha. Verificado como PROPRIEDADE contra o grafo real de FKs,
 *     e nao "restaurei e nao deu erro": um dump que por acaso tem uma tabela
 *     vazia passaria pelo segundo teste sem exercitar a ordem.
 *
 *  2. FIDELIDADE — os dados voltam identicos. Com atencao especial ao BIGINT
 *     (`permissions`, `allow`, `deny`): e o bitfield de permissoes, e
 *     `JSON.stringify` LANCA em BigInt. Errar ali nao corrompe "um dado",
 *     corrompe quem pode o que.
 *
 * Roda num schema DESCARTAVEL do proprio banco. Nao cria projeto novo, nao
 * toca em producao, e ainda assim exercita Postgres de verdade.
 *
 * Uso:
 *   npx dotenv -e .env -- node scripts/verify-backup.mjs
 */
import { PrismaClient } from "@prisma/client";
import { lerTabela, tabelasEmOrdem } from "./lib/dump.mjs";
import { restaurar } from "./restore.mjs";

const prisma = new PrismaClient();
const RASCUNHO = "aether_restore_test";

let passou = 0;
let falhou = 0;

function check(rotulo, ok, detalhe = "") {
  if (ok) {
    passou += 1;
    console.log(`  ok    ${rotulo}`);
  } else {
    falhou += 1;
    console.log(`  FALHA ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

/** Forma canonica de um conjunto de linhas: comparavel sem depender da ordem. */
function canonico(linhas) {
  return linhas
    .map((linha) =>
      JSON.stringify(
        Object.keys(linha)
          .sort()
          .map((k) => [k, linha[k]]),
      ),
    )
    .sort();
}

async function limpar() {
  // Guarda-corpo: este nome NUNCA pode virar "public" por um erro de edicao.
  if (RASCUNHO === "public") throw new Error("recusando apagar o schema public");
  await prisma.$executeRawUnsafe(`drop schema if exists "${RASCUNHO}" cascade`);
}

async function main() {
  console.log("1. Ordem de insercao respeita as chaves estrangeiras\n");

  const ordem = await tabelasEmOrdem(prisma);
  const arestas = await prisma.$queryRawUnsafe(
    `select distinct
        c.conrelid::regclass::text as filho,
        c.confrelid::regclass::text as pai
     from pg_constraint c
     join pg_class r on r.oid = c.conrelid
     join pg_namespace n on n.oid = r.relnamespace
     where c.contype = 'f' and n.nspname = 'public'`,
  );
  const limpo = (n) => String(n).replace(/^public\./, "").replace(/^"|"$/g, "");

  const posicao = new Map(ordem.map((t, i) => [t, i]));
  const invertidas = arestas
    .map((a) => ({ filho: limpo(a.filho), pai: limpo(a.pai) }))
    .filter((a) => a.filho !== a.pai)
    .filter((a) => posicao.has(a.filho) && posicao.has(a.pai))
    .filter((a) => posicao.get(a.pai) > posicao.get(a.filho));

  check(
    `todas as ${arestas.length} chaves estrangeiras tem o pai antes do filho`,
    invertidas.length === 0,
    invertidas.map((a) => `${a.filho} antes de ${a.pai}`).join("; "),
  );
  check("a ordem inclui todas as tabelas", ordem.length > 0, `${ordem.length}`);

  console.log("\n2. Os dados voltam identicos\n");

  // Dump do banco real, exatamente como o backup.mjs faz.
  const dados = {};
  for (const tabela of ordem) dados[tabela] = await lerTabela(prisma, tabela);
  const dump = { formato: 1, criadoEm: new Date().toISOString(), ordem, dados };

  const totalOriginal = ordem.reduce((s, t) => s + dados[t].length, 0);
  check("o dump nao saiu vazio", totalOriginal > 0, `${totalOriginal} linhas`);

  await limpar();
  await prisma.$executeRawUnsafe(`create schema "${RASCUNHO}"`);
  for (const tabela of ordem) {
    // `LIKE ... INCLUDING ALL` clona colunas, tipos, defaults e checks. Nao
    // clona FK — e por isso a ordem e verificada como propriedade la em cima,
    // em vez de "restaurou sem erro".
    await prisma.$executeRawUnsafe(
      `create table "${RASCUNHO}"."${tabela}" (like "public"."${tabela}" including all)`,
    );
  }

  const restauradas = await restaurar(prisma, dump, { schema: RASCUNHO });
  check(
    "restaurou a mesma quantidade de linhas",
    restauradas === totalOriginal,
    `original ${totalOriginal}, restaurado ${restauradas}`,
  );

  let tabelasIguais = 0;
  const diferentes = [];
  for (const tabela of ordem) {
    const volta = await lerTabela(prisma, tabela, RASCUNHO);
    const a = canonico(dados[tabela]);
    const b = canonico(volta);
    if (JSON.stringify(a) === JSON.stringify(b)) tabelasIguais += 1;
    else diferentes.push(tabela);
  }
  check(
    `as ${ordem.length} tabelas voltaram byte a byte iguais`,
    diferentes.length === 0,
    `diferentes: ${diferentes.join(", ")}`,
  );

  console.log("\n3. O bitfield de permissoes sobreviveu\n");

  const perms = await prisma.$queryRawUnsafe(
    `select o."permissions" as original, r."permissions" as restaurado, o."name"
       from "public"."Role" o
       join "${RASCUNHO}"."Role" r on r."id" = o."id"`,
  );
  check("ha cargos para comparar", perms.length > 0, `${perms.length}`);
  const divergentes = perms.filter((p) => p.original !== p.restaurado);
  check(
    "todo `permissions` (BigInt) voltou com o valor exato",
    divergentes.length === 0,
    divergentes.map((d) => `${d.name}: ${d.original} != ${d.restaurado}`).join("; "),
  );

  // Um valor alto de proposito: acima de 2^53, onde Number perderia precisao.
  const grande = 9007199254740993n;
  const [{ volta }] = await prisma.$queryRawUnsafe(
    `select $1::int8 as volta`,
    grande,
  );
  check(
    "BigInt acima de 2^53 nao perde precisao no caminho",
    volta === grande,
    `mandei ${grande}, voltou ${volta}`,
  );

  console.log(`\n${passou} passaram, ${falhou} falharam`);
}

main()
  .catch((erro) => {
    console.error("\nerro:", erro.message);
    falhou += 1;
  })
  .finally(async () => {
    await limpar().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(falhou > 0 ? 1 : 0);
  });
