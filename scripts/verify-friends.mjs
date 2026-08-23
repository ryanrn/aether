/**
 * Verificacao das amizades, contra o banco de VERDADE.
 *
 * O que este script cobre e o que teste unitario nao alcanca: as regras que
 * moram no BANCO (indice unico, check de "nao e si mesmo", cascade) e o
 * fechamento da tabela para a API REST publica do Supabase.
 *
 * Cria usuarios descartaveis e os apaga no fim — NUNCA mexe em conta real.
 *
 * Uso:
 *   dotenv -e .env -- node scripts/verify-friends.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
let passed = 0;
let failed = 0;

function check(rotulo, ok, detalhe = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${rotulo}`);
  } else {
    failed += 1;
    console.log(`  FALHA ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

// Curto de proposito: `username` tem teto de 24, e um prefixo longo fazia
// os tres nomes colidirem depois do corte.
const MARCA = `at${Date.now() % 1_000_000_000}`;
const criados = [];

async function criarUsuario(sufixo) {
  const user = await prisma.user.create({
    data: {
      username: `${MARCA}-${sufixo}`.slice(0, 24),
      displayName: `Cobaia ${sufixo}`,
      email: `${MARCA}-${sufixo}@local.test`,
      passwordHash: "scrypt$16384$8$1$naoimporta$naoimporta",
    },
    select: { id: true, username: true },
  });
  criados.push(user.id);
  return user;
}

/** Mesma consulta do packages/access/src/friends.ts */
async function amigosDe(userId) {
  const linhas = await prisma.friendship.findMany({
    where: {
      status: "ACCEPTED",
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    select: { requesterId: true, addresseeId: true },
  });
  return linhas.map((l) => (l.requesterId === userId ? l.addresseeId : l.requesterId));
}

async function main() {
  const ana = await criarUsuario("ana");
  const bia = await criarUsuario("bia");
  const caio = await criarUsuario("caio");
  console.log(`\ntres usuarios descartaveis criados\n`);

  console.log("Regras que moram no BANCO");

  // Ninguem e amigo de si mesmo — barrado pelo CHECK, nao so pela action.
  let barrou = false;
  try {
    await prisma.friendship.create({
      data: { requesterId: ana.id, addresseeId: ana.id },
    });
  } catch {
    barrou = true;
  }
  check("o banco recusa amizade consigo mesmo", barrou);

  const pedido = await prisma.friendship.create({
    data: { requesterId: ana.id, addresseeId: bia.id },
    select: { id: true, status: true },
  });
  check("pedido nasce PENDING", pedido.status === "PENDING");

  // O mesmo par na MESMA direcao e barrado pelo indice unico.
  let duplicou = false;
  try {
    await prisma.friendship.create({
      data: { requesterId: ana.id, addresseeId: bia.id },
    });
    duplicou = true;
  } catch {
    // esperado
  }
  check("o banco recusa o par duplicado na mesma direcao", !duplicou);

  /**
   * O par INVERTIDO passa pelo banco — o indice e por direcao. Isto nao e
   * bug, e a razao pela qual a action consulta as duas direcoes antes de
   * criar. O teste existe para provar que a defesa esta MESMO na action, e
   * que ninguem pode remove-la achando que o banco cobre.
   */
  const invertido = await prisma.friendship.create({
    data: { requesterId: bia.id, addresseeId: ana.id },
    select: { id: true },
  });
  check(
    "o banco NAO barra o par invertido (por isso a action checa as 2 direcoes)",
    invertido.id !== undefined,
  );
  await prisma.friendship.delete({ where: { id: invertido.id } });

  console.log("\nLista de amigos junta as duas colunas");

  // Pendente NAO conta como amigo.
  check("pedido pendente nao entra na lista de amigos", (await amigosDe(ana.id)).length === 0);

  await prisma.friendship.update({
    where: { id: pedido.id },
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });

  const deAna = await amigosDe(ana.id);
  const deBia = await amigosDe(bia.id);
  check("quem PEDIU ve o outro na lista", deAna.includes(bia.id), JSON.stringify(deAna));
  check(
    "quem RECEBEU ve o outro na lista (a mesma linha, do outro lado)",
    deBia.includes(ana.id),
    JSON.stringify(deBia),
  );
  check("uma linha so, nao duas", deAna.length === 1 && deBia.length === 1);

  // Caio nao tem nada com ninguem.
  check("quem nao e amigo de ninguem tem lista vazia", (await amigosDe(caio.id)).length === 0);

  console.log("\nRemocao e cascade");

  const pedido2 = await prisma.friendship.create({
    data: { requesterId: caio.id, addresseeId: ana.id, status: "ACCEPTED" },
    select: { id: true },
  });
  check("ana agora tem 2 amigos", (await amigosDe(ana.id)).length === 2);
  await prisma.friendship.delete({ where: { id: pedido2.id } });
  check("depois de desfazer, volta a 1", (await amigosDe(ana.id)).length === 1);

  // Apagar a CONTA leva as amizades junto — senao sobraria linha apontando
  // para um usuario que nao existe mais, e a lista do outro quebraria.
  await prisma.user.delete({ where: { id: bia.id } });
  criados.splice(criados.indexOf(bia.id), 1);
  const sobrou = await prisma.friendship.count({
    where: { OR: [{ requesterId: bia.id }, { addresseeId: bia.id }] },
  });
  check("apagar a conta leva as amizades junto (cascade)", sobrou === 0, `${sobrou} sobraram`);
  check("a lista do outro lado esvazia", (await amigosDe(ana.id)).length === 0);

  console.log("\nA tabela esta fechada para a API REST publica");

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    console.log("  pulado — SUPABASE_URL/ANON_KEY nao estao no .env");
  } else {
    const resposta = await fetch(`${url}/rest/v1/Friendship?select=*`, {
      headers: { apikey: anon, authorization: `Bearer ${anon}` },
    });
    check(
      "GET /rest/v1/Friendship com a chave publica e recusado",
      resposta.status === 401 || resposta.status === 403 || resposta.status === 404,
      `respondeu ${resposta.status}`,
    );
  }

  console.log(`\n${passed} passaram, ${failed} falharam`);
}

main()
  .catch((erro) => {
    console.error("\nerro:", erro.message);
    failed += 1;
  })
  .finally(async () => {
    for (const id of criados) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    console.log("usuarios descartaveis removidos");
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
