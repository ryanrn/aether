/**
 * Seed opcional para desenvolvimento: cria dois usuarios de teste e um servidor
 * com a arvore de canais de exemplo. Rode com: npm run db:seed
 */
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient, ChannelType } from "@prisma/client";
import { DEFAULT_ROLE_TEMPLATES } from "@aether/shared";

const prisma = new PrismaClient();

/** Mesmo formato de hash usado em apps/web/src/server/auth/password.ts */
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize("NFKC"), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${derived.toString("base64")}`;
}

async function main() {
  const password = hashPassword("senha123");

  const ryan = await prisma.user.upsert({
    where: { username: "ryan" },
    update: {},
    create: {
      username: "ryan",
      displayName: "Ryan",
      email: "ryan@local.test",
      passwordHash: password,
    },
  });

  const joao = await prisma.user.upsert({
    where: { username: "joao" },
    update: {},
    create: {
      username: "joao",
      displayName: "Joao",
      email: "joao@local.test",
      passwordHash: password,
    },
  });

  const existing = await prisma.server.findFirst({
    where: { name: "Servidor de Teste", ownerId: ryan.id },
  });
  if (existing) {
    console.log("Seed ja aplicado. Servidor existente:", existing.id);
    return;
  }

  const server = await prisma.server.create({
    data: {
      name: "Servidor de Teste",
      ownerId: ryan.id,
      roles: {
        create: DEFAULT_ROLE_TEMPLATES.map((role) => ({
          name: role.name,
          color: role.color,
          permissions: role.permissions,
          position: role.position,
          isDefault: role.isDefault,
          isOwner: role.isOwner,
        })),
      },
    },
    include: { roles: true },
  });

  const geral = await prisma.category.create({
    data: { serverId: server.id, name: "GERAL", position: 0 },
  });
  const gaming = await prisma.category.create({
    data: { serverId: server.id, name: "GAMING", position: 1 },
  });

  await prisma.channel.createMany({
    data: [
      { serverId: server.id, categoryId: geral.id, name: "geral", type: ChannelType.TEXT, position: 0 },
      { serverId: server.id, categoryId: geral.id, name: "Lobby", type: ChannelType.VOICE, position: 1 },
      { serverId: server.id, categoryId: geral.id, name: "Conversa", type: ChannelType.VOICE, position: 2 },
      { serverId: server.id, categoryId: gaming.id, name: "Valorant", type: ChannelType.VOICE, position: 0 },
      { serverId: server.id, categoryId: gaming.id, name: "Minecraft", type: ChannelType.VOICE, position: 1 },
    ],
  });

  const ownerRole = server.roles.find((r) => r.isOwner)!;
  const defaultRole = server.roles.find((r) => r.isDefault)!;

  const ownerMember = await prisma.serverMember.create({
    data: { serverId: server.id, userId: ryan.id },
  });
  await prisma.memberRole.createMany({
    data: [
      { memberId: ownerMember.id, roleId: ownerRole.id },
      { memberId: ownerMember.id, roleId: defaultRole.id },
    ],
  });

  const joaoMember = await prisma.serverMember.create({
    data: { serverId: server.id, userId: joao.id },
  });
  await prisma.memberRole.create({
    data: { memberId: joaoMember.id, roleId: defaultRole.id },
  });

  console.log("Seed aplicado.");
  console.log("  usuarios: ryan / joao  (senha: senha123)");
  console.log("  servidor:", server.id);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
