/**
 * Marca (ou desmarca) o servidor que e o HUB global "AETHER · Grupos"
 * (fase 2, estagio 4b).
 *
 * POR SCRIPT, e nao por tela — mesmo motivo do `definir-servidor-oficial.mjs`:
 * ser o hub coloca o servidor diante de TODA a base, e isso nao pode ser uma
 * chave que o dono liga sozinho.
 *
 * So existe UM hub (indice unico parcial na migracao). Marcar outro com um ja
 * marcado e recusado aqui com a mensagem certa, em vez do erro cru do banco.
 *
 * Marcar NAO liga o hub para ninguem: quem decide e a flag `hub_grupos`
 * (painel da equipe, padrao desligada). Sao dois passos de proposito — da para
 * preparar o servidor antes e abrir quando a moderacao estiver pronta.
 *
 * O script tambem confere o CARGO PADRAO do servidor: e com ele que todo mundo
 * entra no hub, entao ele precisa de VIEW_CHANNEL + CONNECT + SPEAK e de nada
 * administrativo. So avisa — nao muda cargo sozinho.
 *
 * Uso:
 *   npx dotenv -e .env -- node scripts/definir-hub.mjs --listar
 *   npx dotenv -e .env -- node scripts/definir-hub.mjs <id> sim
 *   npx dotenv -e .env -- node scripts/definir-hub.mjs <id> nao
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Os bits de `packages/shared/src/permissions.ts` — repetidos aqui porque o
// script e .mjs puro e nao importa TypeScript. Se mudarem la, mudam aqui.
const BIT = {
  ADMINISTRATOR: 1n << 0n,
  VIEW_CHANNEL: 1n << 6n,
  CONNECT: 1n << 7n,
  SPEAK: 1n << 8n,
};
const NECESSARIOS = ["VIEW_CHANNEL", "CONNECT", "SPEAK"];

async function listar() {
  const servidores = await prisma.server.findMany({
    select: { id: true, name: true, hub: true, _count: { select: { members: true } } },
    orderBy: [{ hub: "desc" }, { name: "asc" }],
    take: 50,
  });
  if (servidores.length === 0) return console.log("Nenhum servidor.");
  for (const s of servidores) {
    console.log(`  ${s.id}`);
    console.log(
      `     ${s.name}  —  ${s._count.members} membro(s)${s.hub ? "  —  HUB" : ""}\n`,
    );
  }
}

async function conferirCargoPadrao(serverId) {
  const cargo = await prisma.role.findFirst({
    where: { serverId, isDefault: true },
    select: { name: true, permissions: true },
  });
  if (!cargo) {
    console.log(
      "\nATENCAO: o servidor nao tem cargo padrao. Quem entrar no hub fica sem\n" +
        "permissao nenhuma e nao consegue entrar em sala. Crie um cargo padrao.",
    );
    return;
  }
  const faltando = NECESSARIOS.filter((nome) => (cargo.permissions & BIT[nome]) === 0n);
  if (faltando.length > 0) {
    console.log(
      `\nATENCAO: o cargo padrao "${cargo.name}" nao tem ${faltando.join(", ")}.\n` +
        "Sem isso, quem entra no hub nao consegue entrar nas salas.",
    );
  }
  if ((cargo.permissions & BIT.ADMINISTRATOR) !== 0n) {
    console.log(
      `\nATENCAO: o cargo padrao "${cargo.name}" tem ADMINISTRATOR. No hub,\n` +
        "isso daria poder de administracao a qualquer conta. Tire antes de abrir.",
    );
  }
}

async function main() {
  if (process.argv.includes("--listar") || process.argv.length < 4) {
    if (process.argv.length < 4 && !process.argv.includes("--listar")) {
      console.log(
        "Uso:\n" +
          "  node scripts/definir-hub.mjs --listar\n" +
          "  node scripts/definir-hub.mjs <id> sim|nao\n",
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
    select: { id: true, name: true, hub: true },
  });
  if (!alvo) {
    console.log(`Servidor "${id}" nao existe. Use --listar para ver os ids.`);
    process.exitCode = 1;
    return;
  }
  if (alvo.hub === ligar) {
    console.log(`"${alvo.name}" ja ${ligar ? "e" : "nao e"} o hub. Nada a fazer.`);
    if (ligar) await conferirCargoPadrao(id);
    return;
  }

  if (ligar) {
    const atual = await prisma.server.findFirst({
      where: { hub: true },
      select: { id: true, name: true },
    });
    if (atual) {
      console.log(
        `Ja existe um hub: "${atual.name}" (${atual.id}).\n` +
          `Desmarque primeiro: node scripts/definir-hub.mjs ${atual.id} nao`,
      );
      process.exitCode = 1;
      return;
    }
  }

  await prisma.server.update({ where: { id }, data: { hub: ligar } });
  console.log(`"${alvo.name}" ${ligar ? "AGORA E" : "nao e mais"} o hub.`);

  if (ligar) {
    await conferirCargoPadrao(id);
    console.log(
      "\nO hub so aparece para as pessoas com a flag `hub_grupos` ligada\n" +
        "(painel da equipe -> Flags). Ela vem DESLIGADA.",
    );
  }
}

main()
  .catch((erro) => {
    console.error("erro:", erro.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
