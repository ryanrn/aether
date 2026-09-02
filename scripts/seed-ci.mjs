/**
 * Fixture EXTRA para a suite de integracao no CI (fase 7d).
 *
 * O `npm run db:seed` cria o minimo: `ryan` (dono), `joao` (membro) e um
 * servidor. Alguns `verify-*` precisam de mais e, sem isso, se auto-pulam em
 * silencio — o que num CI vira cobertura fantasma. Este script acrescenta,
 * de forma idempotente, exatamente o que falta:
 *
 *  - `maria`: um TERCEIRO usuario. O `verify-dm` precisa de alguem que nao e
 *    amigo de ninguem para provar que a conversa dos outros nao vaza.
 *  - amizade `ryan` <-> `joao` ACEITA. O fluxo de DM por socket so roda com
 *    uma amizade real no banco.
 *  - "Servidor Alheio": servidor da `maria`, do qual `ryan` e `joao` NAO sao
 *    membros. O `verify-phase3` tem uma assercao ("servidor do qual nao e
 *    membro e recusado") que so roda se esse servidor existir.
 *
 * Roda DEPOIS do `db:seed`. Fora do CI nao ha por que rodar — e por isso que
 * ele nao entra no `db:seed` normal.
 *
 * Uso:
 *   DATABASE_URL=... node scripts/seed-ci.mjs
 */
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_ROLE_TEMPLATES } from "@aether/shared";

const prisma = new PrismaClient();

/** Mesmo formato de apps/web/src/server/auth/password.ts e do db:seed. */
function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize("NFKC"), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${derived.toString("base64")}`;
}

async function main() {
  const ryan = await prisma.user.findUnique({ where: { username: "ryan" } });
  const joao = await prisma.user.findUnique({ where: { username: "joao" } });
  if (!ryan || !joao) {
    console.error("Seed base ausente. Rode `npm run db:seed` antes.");
    process.exit(1);
  }

  // --- Terceiro usuario -----------------------------------------------------
  const maria = await prisma.user.upsert({
    where: { username: "maria" },
    update: {},
    create: {
      username: "maria",
      displayName: "Maria",
      email: "maria@local.test",
      passwordHash: hashPassword("senha123"),
    },
  });

  // --- Amizade ryan <-> joao (ACEITA) -------------------------------------
  const existente = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: ryan.id, addresseeId: joao.id },
        { requesterId: joao.id, addresseeId: ryan.id },
      ],
    },
  });
  if (!existente) {
    await prisma.friendship.create({
      data: {
        requesterId: ryan.id,
        addresseeId: joao.id,
        status: "ACCEPTED",
        respondedAt: new Date(),
      },
    });
  } else if (existente.status !== "ACCEPTED") {
    await prisma.friendship.update({
      where: { id: existente.id },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    });
  }

  // --- Servidor do qual ryan/joao NAO sao membros -------------------------
  const jaExiste = await prisma.server.findFirst({
    where: { name: "Servidor Alheio", ownerId: maria.id },
  });
  if (!jaExiste) {
    const server = await prisma.server.create({
      data: {
        name: "Servidor Alheio",
        ownerId: maria.id,
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
    await prisma.channel.createMany({
      data: [
        { serverId: server.id, name: "geral", type: "TEXT", position: 0 },
        { serverId: server.id, name: "Voz", type: "VOICE", position: 1 },
      ],
    });
    const ownerRole = server.roles.find((r) => r.isOwner);
    const defaultRole = server.roles.find((r) => r.isDefault);
    const mariaMember = await prisma.serverMember.create({
      data: { serverId: server.id, userId: maria.id },
    });
    await prisma.memberRole.createMany({
      data: [
        { memberId: mariaMember.id, roleId: ownerRole.id },
        { memberId: mariaMember.id, roleId: defaultRole.id },
      ],
    });
  }

  console.log("seed-ci aplicado: maria, amizade ryan<->joao, Servidor Alheio");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
