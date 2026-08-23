/**
 * Nucleo do backup: ordem das tabelas, serializacao e leitura.
 *
 * Separado dos scripts para o backup, a restauracao e o teste de ida e volta
 * usarem exatamente o MESMO codigo. Um teste que exercita outra implementacao
 * nao prova nada sobre a que roda de verdade.
 */

/** Tabelas que nao entram no dump. */
const IGNORADAS = new Set([
  // O historico de migracoes e do Prisma, e ele o reconstroi sozinho. Restaurar
  // linhas antigas aqui faria o Prisma achar que ja aplicou o que nao aplicou.
  "_prisma_migrations",
]);

/**
 * Tabelas do schema, na ordem em que podem ser INSERIDAS sem violar chave
 * estrangeira: pai antes de filho.
 *
 * Derivada do banco, e nao escrita na mao de proposito. Lista fixa envelhece
 * em silencio — alguem adiciona um modelo, esquece do script, e a falha so
 * aparece no dia da restauracao, que e o pior dia possivel para descobrir.
 */
export async function tabelasEmOrdem(prisma, schema = "public") {
  const tabelas = await prisma.$queryRawUnsafe(
    `select tablename from pg_tables where schemaname = $1`,
    schema,
  );
  const nomes = tabelas
    .map((t) => t.tablename)
    .filter((t) => !IGNORADAS.has(t));

  const arestas = await prisma.$queryRawUnsafe(
    `select distinct
        c.conrelid::regclass::text as filho,
        c.confrelid::regclass::text as pai
     from pg_constraint c
     join pg_class r on r.oid = c.conrelid
     join pg_namespace n on n.oid = r.relnamespace
     where c.contype = 'f' and n.nspname = $1`,
    schema,
  );

  /** `public."User"` -> `User`; o regclass vem qualificado e citado. */
  const limpar = (nome) =>
    String(nome)
      .replace(new RegExp(`^${schema}\\.`), "")
      .replace(/^"|"$/g, "");

  const dependeDe = new Map(nomes.map((n) => [n, new Set()]));
  for (const aresta of arestas) {
    const filho = limpar(aresta.filho);
    const pai = limpar(aresta.pai);
    // Autorreferencia (Category -> Category) nao e dependencia entre tabelas.
    if (filho === pai) continue;
    if (dependeDe.has(filho) && dependeDe.has(pai)) {
      dependeDe.get(filho).add(pai);
    }
  }

  const ordem = [];
  const visto = new Set();
  const visitando = new Set();

  function visitar(nome) {
    if (visto.has(nome)) return;
    /**
     * Ciclo entre tabelas: nao da para ordenar, entao seguimos e deixamos o
     * banco reclamar na hora do INSERT. Melhor um erro claro do Postgres do
     * que uma recursao infinita aqui.
     */
    if (visitando.has(nome)) return;
    visitando.add(nome);
    for (const pai of dependeDe.get(nome) ?? []) visitar(pai);
    visitando.delete(nome);
    visto.add(nome);
    ordem.push(nome);
  }

  // Ordem alfabetica na entrada deixa o resultado estavel entre execucoes.
  for (const nome of [...nomes].sort()) visitar(nome);
  return ordem;
}

/**
 * Converte um valor do Postgres para algo que sobrevive a JSON.
 *
 * O caso que importa e o BIGINT. `permissions`, `allow` e `deny` sao o
 * bitfield de permissoes — `JSON.stringify` LANCA em BigInt, e uma conversao
 * descuidada para Number perderia precisao acima de 2^53. Errar aqui nao
 * corrompe "um dado": corrompe quem pode o que.
 */
export function paraJson(valor) {
  if (typeof valor === "bigint") return { __bigint: valor.toString() };
  if (valor instanceof Date) return { __date: valor.toISOString() };
  if (Buffer.isBuffer(valor)) return { __bytes: valor.toString("base64") };
  if (Array.isArray(valor)) return valor.map(paraJson);
  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor).map(([k, v]) => [k, paraJson(v)]),
    );
  }
  return valor;
}

/** O caminho de volta. Precisa espelhar `paraJson` exatamente. */
export function doJson(valor) {
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === "object" && !Array.isArray(valor)) {
    if ("__bigint" in valor) return BigInt(valor.__bigint);
    if ("__date" in valor) return new Date(valor.__date);
    if ("__bytes" in valor) return Buffer.from(valor.__bytes, "base64");
    return Object.fromEntries(
      Object.entries(valor).map(([k, v]) => [k, doJson(v)]),
    );
  }
  if (Array.isArray(valor)) return valor.map(doJson);
  return valor;
}

/** Le uma tabela inteira, ja serializada. */
export async function lerTabela(prisma, tabela, schema = "public") {
  const linhas = await prisma.$queryRawUnsafe(
    `select * from "${schema}"."${tabela}"`,
  );
  return linhas.map(paraJson);
}
