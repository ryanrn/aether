/**
 * Verificacao da FASE 2 sem navegador.
 *
 * Em vez de clicar na interface, este script cria sessoes reais no banco,
 * assina o mesmo JWT que o app assina e faz requisicoes HTTP autenticadas.
 * Assim testamos o caminho de verdade — middleware, guards, filtro de canais
 * privados e renderizacao — e nao uma reimplementacao da regra.
 *
 * Uso (com o dev server rodando):
 *   dotenv -e .env -- node scripts/verify-phase2.mjs
 */
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const prisma = new PrismaClient();
const secret = new TextEncoder().encode(process.env.AUTH_SECRET);

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FALHA ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function sessionCookie(userId) {
  const session = await prisma.session.create({
    data: {
      userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const token = await new SignJWT({ sid: session.id })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer("aether")
    .setAudience("aether-app")
    .setExpirationTime("1h")
    .sign(secret);
  return { cookie: `aether_session=${token}`, sessionId: session.id };
}

async function get(path, cookie) {
  const response = await fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
  const body = response.status === 200 ? await response.text() : "";
  return { status: response.status, body, location: response.headers.get("location") };
}

async function main() {
  console.log(`Alvo: ${BASE}\n`);

  const owner = await prisma.user.findUnique({ where: { username: "ryan" } });
  if (!owner) {
    console.log("Usuario de seed nao encontrado. Rode: npm run db:seed");
    process.exit(1);
  }

  const server = await prisma.server.findFirst({
    where: { ownerId: owner.id },
    include: { roles: true },
  });
  if (!server) {
    console.log("Servidor de seed nao encontrado. Rode: npm run db:seed");
    process.exit(1);
  }

  /**
   * O "membro comum" e criado AGORA, com o cargo Member e mais nada.
   *
   * Antes era o `joao` do seed, e isso quebrou de um jeito instrutivo: em uso
   * normal alguem deu a ele o cargo Moderator pelo proprio app, e como o canal
   * privado do teste e liberado para Moderator, ele passou a enxergar o canal
   * — legitimamente. O app estava CERTO e o teste acusava falha de
   * autorizacao.
   *
   * Um teste de seguranca que reprova porque a pessoa mexeu no app vira ruido,
   * e ruido se aprende a ignorar. Criando o membro aqui, a premissa "nao tem o
   * cargo" deixa de ser torcida e passa a ser fato.
   */
  const memberRole = server.roles.find((role) => role.name === "Member");
  if (!memberRole) {
    console.log("Cargo 'Member' nao encontrado no servidor de seed.");
    process.exit(1);
  }

  const marca = `verify-membro-${Date.now() % 1_000_000_000}`;
  const member = await prisma.user.create({
    data: {
      username: marca.slice(0, 24),
      displayName: "Membro comum (teste)",
      email: `${marca}@local.test`,
      passwordHash: "scrypt$16384$8$1$naoimporta$naoimporta",
    },
    select: { id: true },
  });
  const membership = await prisma.serverMember.create({
    data: { serverId: server.id, userId: member.id },
    select: { id: true },
  });
  await prisma.memberRole.create({
    data: { memberId: membership.id, roleId: memberRole.id },
  });

  const ownerAuth = await sessionCookie(owner.id);
  const memberAuth = await sessionCookie(member.id);
  const createdSessions = [ownerAuth.sessionId, memberAuth.sessionId];

  // canal privado liberado apenas para o cargo Moderator (que joao nao tem)
  const modRole = server.roles.find((role) => role.name === "Moderator");
  const publicChannel = await prisma.channel.findFirst({
    where: { serverId: server.id, isPrivate: false },
  });

  const secretChannel = await prisma.channel.create({
    data: {
      serverId: server.id,
      name: "sala-secreta-verify",
      type: "VOICE",
      isPrivate: true,
      position: 999,
      overwrites: {
        create: [
          {
            target: "ROLE",
            roleId: modRole.id,
            // VIEW_CHANNEL | CONNECT | SPEAK
            allow: (1n << 6n) | (1n << 7n) | (1n << 8n),
            deny: 0n,
          },
        ],
      },
    },
  });

  try {
    console.log("Sessao e acesso basico");
    const anon = await get(`/app/s/${server.id}`);
    check("sem cookie, /app/s/<id> redireciona para login", anon.status === 307, `status ${anon.status}`);

    const ownerView = await get(`/app/s/${server.id}`, ownerAuth.cookie);
    check("dono abre o servidor", ownerView.status === 200, `status ${ownerView.status}`);

    const memberView = await get(`/app/s/${server.id}`, memberAuth.cookie);
    check("membro comum abre o servidor", memberView.status === 200, `status ${memberView.status}`);

    console.log("\nCanal privado");
    check(
      "dono ENXERGA o canal privado na arvore",
      ownerView.body.includes("sala-secreta-verify"),
    );
    check(
      "membro sem o cargo NAO recebe o canal privado no HTML",
      !memberView.body.includes("sala-secreta-verify"),
    );

    const memberDirect = await get(
      `/app/s/${server.id}/c/${secretChannel.id}`,
      memberAuth.cookie,
    );
    check(
      "acesso direto por URL ao canal privado responde 404",
      memberDirect.status === 404,
      `status ${memberDirect.status}`,
    );

    const ownerDirect = await get(
      `/app/s/${server.id}/c/${secretChannel.id}`,
      ownerAuth.cookie,
    );
    check("dono abre o canal privado por URL", ownerDirect.status === 200, `status ${ownerDirect.status}`);

    console.log("\nCanal publico");
    if (publicChannel) {
      const memberPublic = await get(
        `/app/s/${server.id}/c/${publicChannel.id}`,
        memberAuth.cookie,
      );
      check("membro abre canal publico", memberPublic.status === 200, `status ${memberPublic.status}`);
    }

    console.log("\nPainel de configuracoes");
    const ownerSettings = await get(`/app/s/${server.id}/settings`, ownerAuth.cookie);
    check("dono abre /settings", ownerSettings.status === 200, `status ${ownerSettings.status}`);

    const memberSettings = await get(`/app/s/${server.id}/settings`, memberAuth.cookie);
    check(
      "membro sem MANAGE_ROLES recebe 404 em /settings",
      memberSettings.status === 404,
      `status ${memberSettings.status}`,
    );

    console.log("\nIsolamento entre servidores");
    const otherServer = await prisma.server.findFirst({
      where: { id: { not: server.id } },
    });
    if (otherServer) {
      const cross = await get(`/app/s/${otherServer.id}`, memberAuth.cookie);
      check(
        "servidor do qual nao e membro responde 404",
        cross.status === 404,
        `status ${cross.status}`,
      );
    } else {
      console.log("  (pulado: so existe um servidor no banco)");
    }
  } finally {
    await prisma.channelOverwrite.deleteMany({ where: { channelId: secretChannel.id } });
    await prisma.channel.delete({ where: { id: secretChannel.id } });
    await prisma.session.deleteMany({ where: { id: { in: createdSessions } } });
    // O membro descartavel sai junto; o cascade leva a associacao e o cargo.
    await prisma.user.delete({ where: { id: member.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passaram, ${failed} falharam`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
