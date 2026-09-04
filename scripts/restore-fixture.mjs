/**
 * Devolve o usuario de teste ao servidor de seed.
 *
 * Testar moderacao de verdade — expulsar ou banir o `joao` — derruba a
 * pre-condicao dos scripts de verificacao. Em vez de exigir um `db:seed`
 * inteiro (que mexe em outras coisas), este script restaura so o que a
 * moderacao tirou.
 *
 * Uso:
 *   dotenv -e .env -- node scripts/restore-fixture.mjs
 */
import { PrismaClient } from "@prisma/client";
import { escolherServidorDeTeste } from "./lib/fixture.mjs";

const prisma = new PrismaClient();

try {
  const owner = await prisma.user.findUnique({ where: { username: "ryan" } });
  const member = await prisma.user.findUnique({ where: { username: "joao" } });
  if (!owner || !member) {
    console.log("Usuarios de seed nao encontrados. Rode: npm run db:seed");
    process.exit(1);
  }

  // A MESMA escolha que os verify fazem — ver o comentario em lib/fixture.mjs.
  const server = await escolherServidorDeTeste(prisma, owner.id);
  if (!server) {
    console.log("Servidor de seed nao encontrado. Rode: npm run db:seed");
    process.exit(1);
  }

  const removed = await prisma.ban.deleteMany({
    where: { serverId: server.id, userId: member.id },
  });
  if (removed.count > 0) console.log(`banimento revogado (${removed.count})`);

  const existing = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId: server.id, userId: member.id } },
  });

  const role = await prisma.role.findFirst({
    where: { serverId: server.id, isDefault: true },
    select: { id: true, name: true },
  });
  if (!role) {
    console.log("Cargo padrao nao encontrado. Rode: npm run db:seed");
    process.exit(1);
  }

  if (existing) {
    /**
     * Ja e membro — mas o `verify-phase5` mira o CARGO PADRAO num overwrite de
     * canal, entao ser membro sem esse cargo ainda quebra dois testes de tela.
     * `upsert` para garantir o cargo sem falhar se ja estiver la.
     */
    await prisma.memberRole.upsert({
      where: { memberId_roleId: { memberId: existing.id, roleId: role.id } },
      create: { memberId: existing.id, roleId: role.id },
      update: {},
    });
    console.log(`joao ja era membro; cargo ${role.name} garantido`);
  } else {
    const created = await prisma.serverMember.create({
      data: { serverId: server.id, userId: member.id },
    });
    await prisma.memberRole.create({
      data: { memberId: created.id, roleId: role.id },
    });
    console.log(`joao readicionado com o cargo ${role.name}`);
  }

  const members = await prisma.serverMember.findMany({
    where: { serverId: server.id },
    select: { user: { select: { username: true } } },
  });
  console.log(
    `membros de "${server.name}": ${members.map((m) => m.user.username).join(", ")}`,
  );
} finally {
  await prisma.$disconnect();
}
