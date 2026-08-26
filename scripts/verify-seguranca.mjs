/**
 * Verificacao de SEGURANCA — corrida no consumo de convite.
 *
 * O que esta em teste nao e codigo nosso, e uma PREMISSA sobre o Postgres.
 *
 * A correcao do TOCTOU do `maxUses` troca "ler, decidir, gravar" por um
 * UPDATE condicional:
 *
 *     UPDATE "Invite" SET uses = uses + 1 WHERE id = $1 AND uses < $2
 *
 * Isso so resolve se o banco reavaliar o `WHERE` DEPOIS de esperar a
 * transacao concorrente comitar. Em READ COMMITTED o Postgres faz isso — a
 * segunda transacao bloqueia na linha, e quando o lock sai ela re-testa o
 * predicado contra a versao nova e nao atualiza nada. Se ela reavaliasse
 * contra o snapshot antigo, as duas passariam e a correcao seria decorativa.
 *
 * Um teste unitario nao consegue dizer isso: a resposta depende do banco de
 * verdade. Entao aqui abrimos DUAS transacoes de fato e contamos quantas
 * conseguiram consumir um convite de uso unico.
 *
 * Uso:
 *   npx dotenv -e .env -- node scripts/verify-seguranca.mjs
 */
import { PrismaClient } from "@prisma/client";

/**
 * DOIS CLIENTES, e nao um.
 *
 * A primeira versao deste teste usava um cliente so e "passava" — falsamente.
 * O `DATABASE_URL` do projeto termina em `connection_limit=1`: duas
 * transacoes disparadas com `Promise.all` no mesmo cliente nao disputam nada,
 * elas entram em FILA na unica conexao. A segunda so comeca depois de a
 * primeira comitar, entao ela le o valor ja atualizado e recusa sozinha — sem
 * o predicado ter feito trabalho nenhum.
 *
 * Quem denunciou isso foi a contraprova la embaixo: ela roda o codigo ANTIGO,
 * que tem de falhar. Quando ela tambem "passou", ficou claro que a corrida nao
 * estava acontecendo.
 *
 * Vale dizer por que a corrida e real em producao mesmo com limite 1: o limite
 * e POR INSTANCIA, e a Vercel sobe varias. Duas pessoas resgatando o mesmo
 * convite caem tipicamente em instancias diferentes, cada uma com a sua
 * conexao. O ambiente de teste e que era artificialmente serial.
 *
 * `DIRECT_URL` porque e a conexao sem pgbouncer — o pooler em modo transaction
 * atrapalha transacao interativa.
 */
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const clienteA = new PrismaClient({ datasources: { db: { url } } });
const clienteB = new PrismaClient({ datasources: { db: { url } } });
const prisma = clienteA;
let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FALHOU ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * Consome o convite do jeito que a correcao faz, dentro de uma transacao que
 * segura o lock por um tempo — para garantir SOBREPOSICAO real.
 *
 * Sem a espera, as duas transacoes poderiam simplesmente nao se encontrar: a
 * primeira comitaria antes de a segunda comecar, e o teste passaria sem ter
 * testado corrida nenhuma. O `sleep` dentro da transacao e o que torna a
 * disputa certa em vez de provavel.
 */
async function consumir(cliente, inviteId, maxUses, seguraPorMs) {
  return cliente.$transaction(
    async (tx) => {
      const { count } = await tx.invite.updateMany({
        where: { id: inviteId, uses: { lt: maxUses } },
        data: { uses: { increment: 1 } },
      });
      if (seguraPorMs > 0) {
        await tx.$queryRaw`SELECT pg_sleep(${seguraPorMs / 1000}::float8)::text AS t`;
      }
      return count;
    },
    { timeout: 20_000 },
  );
}

async function main() {
  console.log("\nCorrida no consumo de convite\n");

  const servidor = await prisma.server.findFirst({ select: { id: true, ownerId: true } });
  if (!servidor) {
    console.log("  Sem servidor no banco. Rode `npm run db:seed` antes.");
    process.exit(1);
  }

  const codigo = `sec${Date.now().toString(36)}`;
  const convite = await prisma.invite.create({
    data: {
      code: codigo,
      server: { connect: { id: servidor.id } },
      creator: { connect: { id: servidor.ownerId } },
      maxUses: 1,
      uses: 0,
    },
    select: { id: true },
  });

  try {
    /**
     * As duas disparam juntas. A primeira segura o lock por 300ms; a segunda
     * chega dentro dessa janela e precisa esperar.
     */
    const resultados = await Promise.all([
      consumir(clienteA, convite.id, 1, 300),
      consumir(clienteB, convite.id, 1, 0),
    ]);

    const sucessos = resultados.filter((c) => c === 1).length;
    check(
      "duas transacoes disputando um convite de uso unico: so uma consome",
      sucessos === 1,
      `consumiram ${sucessos} (counts: ${JSON.stringify(resultados)})`,
    );

    const final = await prisma.invite.findUnique({
      where: { id: convite.id },
      select: { uses: true, maxUses: true },
    });
    check(
      "o contador nao passa do limite",
      final.uses <= final.maxUses,
      `uses=${final.uses} maxUses=${final.maxUses}`,
    );

    /**
     * CONTRAPROVA: a mesma corrida SEM o predicado no WHERE — que e como o
     * codigo era. Se este bloco tambem desse "so uma", o teste acima nao
     * estaria provando nada sobre a correcao, so sobre o banco estar lento.
     */
    await prisma.invite.update({ where: { id: convite.id }, data: { uses: 0 } });

    const semGuarda = async (cliente, seguraPorMs) =>
      cliente.$transaction(
        async (tx) => {
          const antes = await tx.invite.findUnique({
            where: { id: convite.id },
            select: { uses: true, maxUses: true },
          });
          if (antes.uses >= antes.maxUses) return 0;
          if (seguraPorMs > 0) {
            await tx.$queryRaw`SELECT pg_sleep(${seguraPorMs / 1000}::float8)::text AS t`;
          }
          await tx.invite.update({
            where: { id: convite.id },
            data: { uses: { increment: 1 } },
          });
          return 1;
        },
        { timeout: 20_000 },
      );

    const antigos = await Promise.all([
      semGuarda(clienteA, 300),
      semGuarda(clienteB, 300),
    ]);
    const sucessosAntigos = antigos.filter((c) => c === 1).length;
    check(
      "contraprova: o codigo antigo deixa as duas passarem",
      sucessosAntigos === 2,
      `consumiram ${sucessosAntigos} — se deu 1, a corrida nao aconteceu e o teste acima nao vale`,
    );

    const depois = await prisma.invite.findUnique({
      where: { id: convite.id },
      select: { uses: true },
    });
    check(
      "contraprova: o contador estourou o limite",
      depois.uses === 2,
      `uses=${depois.uses}`,
    );
  } finally {
    await prisma.invite.delete({ where: { id: convite.id } }).catch(() => {});
  }

  console.log(`\n${passed} ok, ${failed} falhou\n`);
  await Promise.all([clienteA.$disconnect(), clienteB.$disconnect()]);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (erro) => {
  console.error(erro);
  await Promise.all([clienteA.$disconnect(), clienteB.$disconnect()]);
  process.exit(1);
});
