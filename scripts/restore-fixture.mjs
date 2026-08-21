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

const prisma = new PrismaClient();

try {
  const owner = await prisma.user.findUnique({ where: { username: "ryan" } });
  const member = await prisma.user.findUnique({ where: { username: "joao" } });
  if (!owner || !member) {
    console.log("Usuarios de seed nao encontrados. Rode: npm run db:seed");
    process.exit(1);
  }

  const server = await prisma.server.findFirst({ where: { ownerId: owner.id } });
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

  if (existing) {
    console.log("joao ja era membro; nada a recriar");
  } else {
    const role = await prisma.role.findFirst({
      where: { serverId: server.id, isDefault: true },
      select: { id: true, name: true },
    });
    if (!role) {
      console.log("Cargo padrao nao encontrado. Rode: npm run db:seed");
      process.exit(1);
    }
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
