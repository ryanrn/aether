/**
 * Manda uma mensagem como OUTRA pessoa, para conferir o contador do trilho.
 *
 * Existe porque o contador so tem valor quando a mensagem vem de um servidor
 * que voce NAO esta olhando — e isso nao da para reproduzir com uma aba so.
 *
 * Uso:
 *   npx dotenv -e .env -- node scripts/testar-badge.mjs
 */
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { io } from "socket.io-client";

const BASE = process.env.VERIFY_REALTIME_URL ?? "http://localhost:4000";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

async function main() {
  /**
   * Um canal de um servidor onde o RYAN e membro — senao a mensagem vai para
   * um servidor que ele nem ve, e a bolinha nao acender seria o comportamento
   * certo, nao um defeito. Foi exatamente o que a primeira versao fez.
   */
  const ryan = await prisma.user.findUnique({
    where: { username: "ryan" },
    select: { id: true },
  });
  const meus = await prisma.serverMember.findMany({
    where: { userId: ryan.id },
    select: { serverId: true },
  });
  const canal = await prisma.channel.findFirst({
    where: {
      type: "TEXT",
      isPrivate: false,
      serverId: { in: meus.map((m) => m.serverId) },
    },
    select: { id: true, name: true, serverId: true },
  });

  /** Alguem que NAO seja o ryan, para a mensagem contar como nao lida. */
  const outro = await prisma.serverMember.findFirst({
    where: {
      serverId: canal.serverId,
      user: { username: { not: "ryan" } },
    },
    select: { userId: true, user: { select: { username: true } } },
  });

  const sessao = await prisma.session.create({
    data: {
      userId: outro.userId,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
  const token = await new SignJWT({ sid: sessao.id })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(outro.userId)
    .setIssuedAt()
    .setIssuer("aether")
    .setAudience("aether-app")
    .setExpirationTime("10m")
    .sign(secret);

  const socket = io(BASE, {
    path: "/ws",
    transports: ["websocket"],
    extraHeaders: { cookie: `aether_session=${token}` },
    reconnection: false,
  });

  await new Promise((r) => socket.once("connect", r));

  const texto = `badge ${Date.now().toString(36)}`;
  const resposta = await new Promise((r) =>
    socket.emit(
      "message:send",
      { conversationId: canal.id, content: texto, nonce: texto },
      r,
    ),
  );

  console.log(
    resposta.ok
      ? `enviada por ${outro.user.username} em #${canal.name} (servidor ${canal.serverId})`
      : `falhou: ${resposta.error}`,
  );

  socket.close();
  await prisma.session.delete({ where: { id: sessao.id } }).catch(() => {});
  await prisma.$disconnect();
  process.exit(resposta.ok ? 0 : 1);
}

main().catch(async (erro) => {
  console.error(erro);
  await prisma.$disconnect();
  process.exit(1);
});
