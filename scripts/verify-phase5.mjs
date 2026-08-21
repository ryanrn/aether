/**
 * Verificacao da FASE 5 — compartilhamento de tela.
 *
 * O que este script prova: que o SINAL de "estou transmitindo" respeita a
 * permissao SCREEN_SHARE no servidor, e que ele se apaga sozinho quando a
 * pessoa sai da call ou troca de canal.
 *
 * O que ele NAO prova: que a imagem chega. Captura de tela exige
 * getDisplayMedia, que precisa de um navegador de verdade com alguem clicando
 * no seletor nativo — teste manual, com duas janelas.
 *
 * Uso (com o gateway rodando):
 *   dotenv -e .env -- node scripts/verify-phase5.mjs
 */
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { io } from "socket.io-client";

const BASE = process.env.VERIFY_REALTIME_URL ?? "http://localhost:4000";
const prisma = new PrismaClient();
const authSecret = new TextEncoder().encode(process.env.AUTH_SECRET);
let passed = 0;
let failed = 0;

/** Bits espelhados de packages/shared/src/permissions.ts */
const PERM = { SCREEN_SHARE: 1n << 9n };

function check(label, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FALHA ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const section = (name) => console.log(`\n${name}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createdSessions = [];
const createdChannels = [];

async function sessionCookie(userId) {
  const session = await prisma.session.create({
    data: { userId, expiresAt: new Date(Date.now() + 3600e3) },
  });
  createdSessions.push(session.id);
  const token = await new SignJWT({ sid: session.id })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer("aether")
    .setAudience("aether-app")
    .setExpirationTime("1h")
    .sign(authSecret);
  return `aether_session=${token}`;
}

function connect(cookie) {
  return new Promise((resolve) => {
    const socket = io(BASE, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { cookie },
      reconnection: false,
      timeout: 5000,
    });
    socket.once("connect", () => resolve({ ok: true, socket }));
    socket.once("connect_error", (error) =>
      resolve({ ok: false, error: error.message }),
    );
  });
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    socket.emit(event, payload, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

function waitFor(socket, event, predicate, ms = 3500) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, ms);
    function handler(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

async function voiceChannel(serverId, roleId, deny) {
  const channel = await prisma.channel.create({
    data: {
      serverId,
      name: `verify5-${Math.random().toString(16).slice(2, 8)}`,
      type: "VOICE",
      position: 950,
      ...(deny > 0n
        ? { overwrites: { create: [{ target: "ROLE", roleId, allow: 0n, deny }] } }
        : {}),
    },
    select: { id: true },
  });
  createdChannels.push(channel.id);
  return channel.id;
}

async function requireGatewayUp() {
  try {
    const response = await fetch(`${BASE}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.log(
      `\nGateway nao responde em ${BASE} (${error.message}).` +
        `\nSuba com:  npm run dev:realtime\n`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }
}

async function main() {
  console.log(`Alvo: ${BASE}`);
  await requireGatewayUp();

  const owner = await prisma.user.findUnique({ where: { username: "ryan" } });
  const member = await prisma.user.findUnique({ where: { username: "joao" } });
  const server = await prisma.server.findFirst({ where: { ownerId: owner.id } });
  const memberRole = await prisma.role.findFirst({
    where: { serverId: server?.id, isDefault: true },
    select: { id: true },
  });
  if (!owner || !member || !server || !memberRole) {
    console.log("Seed ausente. Rode: npm run db:seed");
    process.exit(1);
  }

  const allowed = await voiceChannel(server.id, memberRole.id, 0n);
  const denied = await voiceChannel(server.id, memberRole.id, PERM.SCREEN_SHARE);

  const watcher = await connect(await sessionCookie(owner.id));
  const sharer = await connect(await sessionCookie(member.id));
  if (!watcher.ok || !sharer.ok) throw new Error("nao conectou");
  await emitWithAck(watcher.socket, "server:join", server.id);
  await emitWithAck(sharer.socket, "server:join", server.id);

  section("Indicador de transmissao");

  await emitWithAck(sharer.socket, "voice:join", { channelId: allowed });

  const sawOn = waitFor(
    watcher.socket,
    "voice:update",
    (p) => p.participant.userId === member.id && p.participant.streaming === true,
  );
  sharer.socket.emit("voice:streaming", true);
  check("com SCREEN_SHARE, o indicador acende para os outros", (await sawOn) !== null);

  const sawOff = waitFor(
    watcher.socket,
    "voice:update",
    (p) => p.participant.userId === member.id && p.participant.streaming === false,
  );
  sharer.socket.emit("voice:streaming", false);
  check("desligar propaga", (await sawOff) !== null);

  section("Permissao e imposta no servidor");

  await emitWithAck(sharer.socket, "voice:join", { channelId: denied });
  await sleep(300);

  let leaked = false;
  const leakWatcher = (p) => {
    if (p.participant.userId === member.id && p.participant.streaming === true) {
      leaked = true;
    }
  };
  watcher.socket.on("voice:update", leakWatcher);
  sharer.socket.emit("voice:streaming", true);
  await sleep(1200);
  watcher.socket.off("voice:update", leakWatcher);
  check(
    "sem SCREEN_SHARE, o indicador NAO acende nem mentindo pelo socket",
    !leaked,
  );

  section("O indicador se apaga sozinho");

  await emitWithAck(sharer.socket, "voice:join", { channelId: allowed });
  const sawOnAgain = waitFor(
    watcher.socket,
    "voice:update",
    (p) => p.participant.userId === member.id && p.participant.streaming === true,
  );
  sharer.socket.emit("voice:streaming", true);
  await sawOnAgain;

  const sawChannelSwitch = waitFor(
    watcher.socket,
    "voice:update",
    (p) =>
      p.participant.userId === member.id &&
      p.participant.channelId === denied &&
      p.participant.streaming === false,
  );
  await emitWithAck(sharer.socket, "voice:join", { channelId: denied });
  check(
    "trocar de canal encerra a transmissao",
    (await sawChannelSwitch) !== null,
  );

  await emitWithAck(sharer.socket, "voice:join", { channelId: allowed });
  sharer.socket.emit("voice:streaming", true);
  await sleep(400);

  const sawLeave = waitFor(
    watcher.socket,
    "voice:update",
    (p) => p.participant.userId === member.id && p.participant.channelId === null,
  );
  sharer.socket.close();
  check("cair da call remove o participante e o indicador", (await sawLeave) !== null);

  watcher.socket.close();
}

try {
  await main();
} catch (error) {
  failed += 1;
  console.log(`\nErro: ${error.message}`);
} finally {
  await prisma.channel
    .deleteMany({ where: { id: { in: createdChannels } } })
    .catch(() => undefined);
  await prisma.session
    .deleteMany({ where: { id: { in: createdSessions } } })
    .catch(() => undefined);
  await prisma.$disconnect();
}

console.log(`\n${passed} passaram, ${failed} falharam`);
process.exit(failed ? 1 : 0);
