/**
 * Cria o servidor "AETHER — Beta" para os testers, com dono = a conta do Ryan.
 *
 * Espelha `createServerForUser` (apps/web/src/server/services/servers.ts) —
 * mesmos cargos padrao, mesmo esquema de membro/dono/convite — mas com uma
 * arvore de canais propria: boas-vindas, bugs e feedback em texto, um Lobby de
 * voz. Idempotente: se ja existe um servidor com esse nome do mesmo dono, so
 * imprime o convite e sai.
 *
 * Uso (tsx, porque importa de @aether/shared):
 *   npx dotenv -e .env -- npx tsx scripts/criar-servidor-beta.mts
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_ROLE_TEMPLATES } from "@aether/shared";

const prisma = new PrismaClient();
const NOME = "AETHER — Beta";
const DONO_EMAIL = "ryanfelipefelix@gmail.com";
const BASE_URL = "https://aether-mocha-phi.vercel.app";

const ARVORE = [
  {
    categoria: "COMECE AQUI",
    canais: [
      { name: "boas-vindas", type: "TEXT" },
      { name: "avisos", type: "TEXT" },
    ],
  },
  {
    categoria: "REPORTE",
    canais: [
      { name: "bugs", type: "TEXT" },
      { name: "feedback", type: "TEXT" },
    ],
  },
  {
    categoria: "PAPO",
    canais: [
      { name: "geral", type: "TEXT" },
      { name: "Lobby", type: "VOICE" },
    ],
  },
];

function codigoDeConvite() {
  const alfabeto = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(8);
  let c = "";
  for (const b of bytes) c += alfabeto[b % alfabeto.length];
  return c;
}

async function main() {
  const dono = await prisma.user.findUnique({
    where: { email: DONO_EMAIL },
    select: { id: true, username: true },
  });
  if (!dono) throw new Error(`Conta ${DONO_EMAIL} nao encontrada.`);

  const existente = await prisma.server.findFirst({
    where: { name: NOME, ownerId: dono.id },
    select: { id: true, invites: { select: { code: true }, take: 1 } },
  });
  if (existente) {
    console.log(`Ja existe. Convite: ${BASE_URL}/invite/${existente.invites[0]?.code ?? "(sem)"}`);
    return;
  }

  const { serverId, code } = await prisma.$transaction(async (tx) => {
    const server = await tx.server.create({
      data: {
        name: NOME,
        ownerId: dono.id,
        roles: {
          create: DEFAULT_ROLE_TEMPLATES.map((t) => ({
            name: t.name,
            color: t.color,
            permissions: t.permissions,
            position: t.position,
            isDefault: t.isDefault,
            isOwner: t.isOwner,
          })),
        },
      },
      include: { roles: true },
    });

    let posCategoria = 0;
    for (const grupo of ARVORE) {
      const cat = await tx.category.create({
        data: { serverId: server.id, name: grupo.categoria, position: posCategoria++ },
      });
      await tx.channel.createMany({
        data: grupo.canais.map((canal, i) => ({
          serverId: server.id,
          categoryId: cat.id,
          name: canal.name,
          type: canal.type,
          position: i,
        })),
      });
    }

    const ownerRole = server.roles.find((r) => r.isOwner);
    const defaultRole = server.roles.find((r) => r.isDefault);
    const membro = await tx.serverMember.create({
      data: { serverId: server.id, userId: dono.id },
    });
    const links = [];
    if (ownerRole) links.push({ memberId: membro.id, roleId: ownerRole.id });
    if (defaultRole) links.push({ memberId: membro.id, roleId: defaultRole.id });
    if (links.length) await tx.memberRole.createMany({ data: links });

    const convite = codigoDeConvite();
    await tx.invite.create({
      data: { code: convite, serverId: server.id, creatorId: dono.id },
    });

    return { serverId: server.id, code: convite };
  });

  console.log(`Servidor "${NOME}" criado — dono @${dono.username} (${serverId}).`);
  console.log(`\nConvite para os testers:\n  ${BASE_URL}/invite/${code}\n`);
  console.log("O convite nao expira e nao tem limite de usos por padrao.");
  console.log("Canais: #boas-vindas #avisos | #bugs #feedback | #geral + Lobby (voz)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
