/**
 * Pre-condicoes dos scripts de verificacao.
 *
 * Por que existe: os scripts usam os usuarios de seed (`ryan` dono, `joao`
 * membro) num servidor real. Moderar de verdade — expulsar ou banir o `joao`
 * enquanto testa — quebra essa suposicao, e o resultado eram QUINZE falhas
 * espalhadas em vez de uma frase dizendo o que aconteceu.
 *
 * Um conjunto de testes que falha de forma obscura quando o cenario muda gasta
 * mais tempo do que economiza. Aqui a checagem acontece antes de tudo e diz
 * exatamente o que fazer.
 */

export async function requireSeedFixture(prisma) {
  const owner = await prisma.user.findUnique({ where: { username: "ryan" } });
  const member = await prisma.user.findUnique({ where: { username: "joao" } });

  if (!owner || !member) {
    fail("Usuarios de seed nao encontrados.", "npm run db:seed");
  }

  const server = await prisma.server.findFirst({ where: { ownerId: owner.id } });
  if (!server) {
    fail("Servidor de seed nao encontrado.", "npm run db:seed");
  }

  const banned = await prisma.ban.findUnique({
    where: { serverId_userId: { serverId: server.id, userId: member.id } },
  });
  if (banned) {
    fail(
      `O usuario de teste "joao" esta BANIDO de "${server.name}".`,
      'Revogue o banimento em Configuracoes > Banimentos, ou rode:\n' +
        "  npx dotenv -e .env -- node scripts/restore-fixture.mjs",
    );
  }

  const membership = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId: server.id, userId: member.id } },
  });
  if (!membership) {
    fail(
      `O usuario de teste "joao" nao e mais membro de "${server.name}".`,
      "Provavelmente foi expulso durante um teste de moderacao. Restaure com:\n" +
        "  npx dotenv -e .env -- node scripts/restore-fixture.mjs",
    );
  }

  const defaultRole = await prisma.role.findFirst({
    where: { serverId: server.id, isDefault: true },
    select: { id: true },
  });
  if (!defaultRole) {
    fail("Cargo padrao nao encontrado no servidor de seed.", "npm run db:seed");
  }

  return { owner, member, server, membership, defaultRole };
}

function fail(problem, remedy) {
  console.log(`\n${problem}\n${remedy}\n`);
  process.exit(1);
}
