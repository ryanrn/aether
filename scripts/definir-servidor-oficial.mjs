/**
 * Marca (ou desmarca) um servidor como OFICIAL do Aether.
 *
 * Servidor oficial e fixado no topo de "Explorar comunidades" e ganha selo.
 *
 * POR SCRIPT, e nao pela tela do dono: selo que o proprio interessado se da
 * nao vale nada. Se a chave estivesse nas configuracoes do servidor, todo
 * servidor seria oficial no dia seguinte e o selo viraria enfeite.
 *
 * MARCAR OFICIAL NAO COLOCA NA VITRINE. Sao eixos diferentes: entrar na
 * vitrine e um PEDIDO do dono que a equipe aprova; `oficial` e so nosso, e
 * decide destaque e selo. Um servidor oficial que ninguem aprovou continua
 * fora da vitrine — e o script avisa disso em vez de aprovar por conta
 * propria, porque publicar o servidor de alguem sem a pessoa pedir seria
 * decidir no lugar dela.
 *
 * Uso:
 *   npx dotenv -e .env -- node scripts/definir-servidor-oficial.mjs --listar
 *   npx dotenv -e .env -- node scripts/definir-servidor-oficial.mjs <id> sim
 *   npx dotenv -e .env -- node scripts/definir-servidor-oficial.mjs <id> nao
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function listar() {
  const servidores = await prisma.server.findMany({
    select: {
      id: true,
      name: true,
      vitrine: true,
      oficial: true,
      _count: { select: { members: true } },
    },
    orderBy: [{ oficial: "desc" }, { name: "asc" }],
    take: 50,
  });

  if (servidores.length === 0) {
    console.log("Nenhum servidor.");
    return;
  }

  console.log(`${servidores.length} servidor(es):\n`);
  for (const s of servidores) {
    const marcas = [
      s.oficial ? "OFICIAL" : null,
      s.vitrine === "APROVADO" ? "na vitrine" : `vitrine: ${s.vitrine.toLowerCase()}`,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`  ${s.id}`);
    console.log(`     ${s.name}  —  ${s._count.members} membro(s)  —  ${marcas}\n`);
  }
}

async function main() {
  if (process.argv.includes("--listar") || process.argv.length < 4) {
    if (process.argv.length < 4 && !process.argv.includes("--listar")) {
      console.log(
        "Uso:\n" +
          "  node scripts/definir-servidor-oficial.mjs --listar\n" +
          "  node scripts/definir-servidor-oficial.mjs <id> sim|nao\n",
      );
    }
    return listar();
  }

  const id = process.argv[2];
  const valor = String(process.argv[3]).toLowerCase();
  const ligar = ["sim", "s", "true", "1"].includes(valor);
  const desligar = ["nao", "n", "false", "0"].includes(valor);

  if (!ligar && !desligar) {
    console.log(`Nao entendi "${process.argv[3]}". Use "sim" ou "nao".`);
    process.exitCode = 1;
    return;
  }

  const alvo = await prisma.server.findUnique({
    where: { id },
    select: { id: true, name: true, vitrine: true, oficial: true },
  });

  if (!alvo) {
    console.log(`Servidor "${id}" nao existe. Use --listar para ver os ids.`);
    process.exitCode = 1;
    return;
  }

  if (alvo.oficial === ligar) {
    console.log(
      `"${alvo.name}" ja ${ligar ? "e" : "nao e"} oficial. Nada a fazer.`,
    );
    return;
  }

  await prisma.server.update({ where: { id }, data: { oficial: ligar } });
  console.log(
    `"${alvo.name}" ${ligar ? "AGORA E" : "nao e mais"} servidor oficial.`,
  );

  if (ligar && alvo.vitrine !== "APROVADO") {
    console.log(
      "\nATENCAO: ele NAO esta APROVADO na vitrine, entao o selo nao aparece\n" +
        "para ninguem ainda. Sao dois passos, e nenhum acontece aqui:\n" +
        "  1. o DONO pede, em Configuracoes do servidor -> Explorar comunidades\n" +
        "  2. a EQUIPE aprova, em Configuracoes -> Comunidades\n\n" +
        "Nao faco nenhum dos dois por este script de proposito: publicar o\n" +
        "servidor de alguem sem a pessoa pedir seria decidir no lugar dela.",
    );
  }
}

main()
  .catch((erro) => {
    console.error("erro:", erro.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
