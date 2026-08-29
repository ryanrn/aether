/**
 * Concede ou tira administracao GLOBAL do produto.
 *
 * Equipe NAO e dono de servidor: dono manda no servidor dele, equipe mexe no
 * que vale para a base inteira — hoje, a fila de jogos sugeridos. Sao eixos
 * diferentes de proposito, para que ter um servidor nao de a ninguem o poder
 * de escrever no catalogo de todo mundo.
 *
 * POR SCRIPT, e nao por tela: nao existe "promover a equipe" na interface, e
 * nao deve existir enquanto a equipe for uma pessoa. Tela de promocao e
 * superficie de ataque para um poder que hoje se concede em dez segundos por
 * linha de comando.
 *
 * Uso:
 *   npx dotenv -e .env -- node scripts/definir-equipe.mjs ryan sim
 *   npx dotenv -e .env -- node scripts/definir-equipe.mjs ryan nao
 *   npx dotenv -e .env -- node scripts/definir-equipe.mjs --listar
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function listar() {
  const equipe = await prisma.user.findMany({
    where: { equipe: true },
    select: { username: true, displayName: true },
    orderBy: { username: "asc" },
  });
  if (equipe.length === 0) {
    console.log("Ninguem e da equipe ainda.");
    return;
  }
  console.log(`Equipe (${equipe.length}):`);
  for (const u of equipe) console.log(`   ${u.username}  (${u.displayName})`);
}

async function main() {
  if (process.argv.includes("--listar")) return listar();

  const usuario = process.argv[2];
  const valor = process.argv[3];

  if (!usuario || !valor) {
    console.log(
      "Uso:\n" +
        "  node scripts/definir-equipe.mjs <usuario> sim|nao\n" +
        "  node scripts/definir-equipe.mjs --listar",
    );
    process.exitCode = 1;
    return;
  }

  const ligar = ["sim", "s", "true", "1"].includes(valor.toLowerCase());
  const desligar = ["nao", "n", "false", "0"].includes(valor.toLowerCase());
  if (!ligar && !desligar) {
    console.log(`Nao entendi "${valor}". Use "sim" ou "nao".`);
    process.exitCode = 1;
    return;
  }

  const alvo = await prisma.user.findUnique({
    where: { username: usuario },
    select: { id: true, username: true, displayName: true, equipe: true },
  });

  if (!alvo) {
    console.log(`Usuario "${usuario}" nao existe.`);
    process.exitCode = 1;
    return;
  }

  if (alvo.equipe === ligar) {
    console.log(
      `${alvo.username} ja ${ligar ? "e" : "nao e"} da equipe. Nada a fazer.`,
    );
    return;
  }

  await prisma.user.update({
    where: { id: alvo.id },
    data: { equipe: ligar },
  });

  console.log(
    `${alvo.username} (${alvo.displayName}) ${ligar ? "AGORA E" : "nao e mais"} da equipe.`,
  );
  console.log(
    "\nA sessao ja aberta carrega o valor antigo — a pessoa precisa recarregar\n" +
      "a pagina para o painel aparecer ou sumir.",
  );
}

main()
  .catch((erro) => {
    console.error("erro:", erro.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
