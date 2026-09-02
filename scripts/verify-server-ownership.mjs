/**
 * Verificacao de transferencia de posse e exclusao de servidor, contra o
 * banco de VERDADE.
 *
 * O que este script cobre e o que teste unitario nao alcanca: o
 * comportamento real do banco (cascade de `Server.delete`, o unique composto
 * de `MemberRole`) e, principalmente, o bug que motivou a trava — se a
 * transferencia so trocasse `Server.ownerId` sem mover o cargo "Dono" junto,
 * o dono antigo continuaria com ALL_PERMISSIONS como "membro comum".
 *
 * Cria um servidor e usuarios descartaveis, e apaga tudo no fim (o servidor
 * ja sai pelo proprio teste de exclusao; os usuarios saem no `finally`).
 * NUNCA mexe em conta real.
 *
 * Uso:
 *   dotenv -e .env -- node scripts/verify-server-ownership.mjs
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

/** Reproduz o essencial de `createServerForUser`: servidor + cargo "Dono" + membro dono. */
async function criarServidor(ownerId) {
  return prisma.$transaction(async (tx) => {
    const server = await tx.server.create({
      data: {
        name: `Servidor de teste ${MARCA}`,
        ownerId,
        roles: {
          create: [{ name: "Dono", isOwner: true, permissions: (1n << 40n) - 1n, position: 100 }],
        },
      },
      include: { roles: true },
    });
    const member = await tx.serverMember.create({
      data: { serverId: server.id, userId: ownerId },
    });
    const donoRole = server.roles.find((r) => r.isOwner);
    await tx.memberRole.create({
      data: { memberId: member.id, roleId: donoRole.id },
    });
    return { serverId: server.id, donoRoleId: donoRole.id, ownerMemberId: member.id };
  });
}

/** Mesma transacao de `transferOwnershipAction`. */
async function transferir(serverId, donoRoleId, deMemberId, paraMemberId, paraUserId) {
  await prisma.$transaction([
    prisma.server.update({ where: { id: serverId }, data: { ownerId: paraUserId } }),
    prisma.memberRole.deleteMany({ where: { roleId: donoRoleId, memberId: deMemberId } }),
    prisma.memberRole.upsert({
      where: { memberId_roleId: { memberId: paraMemberId, roleId: donoRoleId } },
      create: { memberId: paraMemberId, roleId: donoRoleId },
      update: {},
    }),
  ]);
}

async function main() {
  const ana = await criarUsuario("ana");
  const bia = await criarUsuario("bia");
  console.log(`\ndois usuarios descartaveis criados\n`);

  console.log("Transferencia de posse");

  const { serverId, donoRoleId, ownerMemberId } = await criarServidor(ana.id);
  const biaMember = await prisma.serverMember.create({
    data: { serverId, userId: bia.id },
    select: { id: true },
  });

  let antes = await prisma.server.findUnique({ where: { id: serverId }, select: { ownerId: true } });
  check("o servidor nasce com ana como dona", antes.ownerId === ana.id);

  await transferir(serverId, donoRoleId, ownerMemberId, biaMember.id, bia.id);

  const depois = await prisma.server.findUnique({ where: { id: serverId }, select: { ownerId: true } });
  check("ownerId passa a ser da bia", depois.ownerId === bia.id, depois.ownerId);

  const cargoDaAna = await prisma.memberRole.findUnique({
    where: { memberId_roleId: { memberId: ownerMemberId, roleId: donoRoleId } },
  });
  check(
    "ana PERDE o cargo Dono — sem isto ela manteria ALL_PERMISSIONS como membro comum",
    cargoDaAna === null,
  );

  const cargoDaBia = await prisma.memberRole.findUnique({
    where: { memberId_roleId: { memberId: biaMember.id, roleId: donoRoleId } },
  });
  check("bia RECEBE o cargo Dono", cargoDaBia !== null);

  // Transferir de volta prova que o upsert nao quebra quando o alvo ja teve
  // o cargo antes (idempotencia do caminho de "update: {}").
  await transferir(serverId, donoRoleId, biaMember.id, ownerMemberId, ana.id);
  const cargoDaAnaDeVolta = await prisma.memberRole.findUnique({
    where: { memberId_roleId: { memberId: ownerMemberId, roleId: donoRoleId } },
  });
  check("transferir de volta devolve o cargo para ana", cargoDaAnaDeVolta !== null);

  console.log("\nExclusao — o cascade leva tudo junto");

  const categoria = await prisma.category.create({
    data: { serverId, name: "geral", position: 0 },
  });
  const canal = await prisma.channel.create({
    data: { serverId, categoryId: categoria.id, name: "geral", type: "TEXT", position: 0 },
  });
  await prisma.message.create({
    data: { channelId: canal.id, authorId: ana.id, content: "oi" },
  });
  await prisma.invite.create({
    data: { code: `${MARCA}conv`.slice(0, 12), serverId, creatorId: ana.id },
  });
  await prisma.auditLog.create({
    data: { serverId, actorId: ana.id, action: "server.create" },
  });

  check(
    "antes de excluir: categoria, canal, mensagem, convite e log existem",
    (await prisma.category.count({ where: { serverId } })) === 1 &&
      (await prisma.channel.count({ where: { serverId } })) === 1 &&
      (await prisma.message.count({ where: { channel: { serverId } } })) === 1 &&
      (await prisma.invite.count({ where: { serverId } })) === 1 &&
      (await prisma.auditLog.count({ where: { serverId } })) === 1,
  );

  await prisma.server.delete({ where: { id: serverId } });

  check("o servidor some", (await prisma.server.findUnique({ where: { id: serverId } })) === null);
  check("membros somem (cascade)", (await prisma.serverMember.count({ where: { serverId } })) === 0);
  check("cargos somem (cascade)", (await prisma.role.count({ where: { serverId } })) === 0);
  check("categorias somem (cascade)", (await prisma.category.count({ where: { serverId } })) === 0);
  check("canais somem (cascade)", (await prisma.channel.count({ where: { serverId } })) === 0);
  check("convites somem (cascade)", (await prisma.invite.count({ where: { serverId } })) === 0);
  check("o log de auditoria some (cascade) — por isso 'server.delete' nunca sobrevive para ser lido", (await prisma.auditLog.count({ where: { serverId } })) === 0);
  check(
    "as pessoas continuam existindo — so o servidor e a relacao com ele que somem",
    (await prisma.user.count({ where: { id: { in: [ana.id, bia.id] } } })) === 2,
  );

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
