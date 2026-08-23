/**
 * Verificacao da FASE 7b — revalidacao de sessao e recalculo de salas.
 *
 * Cobre as duas brechas que "conexao aberta nunca recalcula" deixava:
 *
 *  1. Sessao revogada enquanto o socket segue aberto. O gateway so conferia a
 *     linha `Session` no handshake; depois disso o socket valia para sempre.
 *  2. Cargo/canal mudando de permissao sem tirar ninguem do servidor — quem ja
 *     estava conectado continuava recebendo (ou perdendo) canal sem que o
 *     gateway soubesse.
 *
 * O que NAO e testado aqui: as Server Actions que chamam
 * `resyncGatewayRooms`/`evictFromGateway` (updateRoleAction, assignRoleAction,
 * setChannelAccessAction, leaveServerAction, etc). Sao Server Actions do Next,
 * que nao se chamam de fora do navegador — mesmo nao-alvo que o verify-phase6
 * ja assume para kick/ban. Aqui o alvo e a rota interna do gateway direto,
 * exatamente como o /internal/evict ja e testado.
 *
 * Custo: a secao de revalidacao de sessao espera o intervalo real do guarda
 * (30s, ver apps/realtime/src/session-guard.ts) — mais lenta que o resto da
 * suite de proposito. Nao ha como provar que o timer dispara sem esperar o
 * timer disparar.
 *
 * Uso (com o gateway rodando):
 *   dotenv -e .env -- node scripts/verify-phase7b.mjs
 */
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { io } from "socket.io-client";
import {
  connectedClients,
  requireSeedFixture,
  warnBusyGateway,
} from "./lib/fixture.mjs";

const BASE = process.env.VERIFY_REALTIME_URL ?? "http://localhost:4000";
const prisma = new PrismaClient();
const authSecret = process.env.AUTH_SECRET ?? "";
const secretBytes = new TextEncoder().encode(authSecret);
let passed = 0;
let failed = 0;

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
const createdMessages = [];
const createdChannels = [];
const createdOverwrites = [];

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
    .sign(secretBytes);
  return { sessionId: session.id, cookie: `aether_session=${token}` };
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
    socket.once("connect_error", (error) => {
      socket.close();
      resolve({ ok: false, error: error.message });
    });
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

function waitFor(socket, event, predicate = () => true, ms = 6000) {
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

function resyncRooms(serverId, secret) {
  return fetch(`${BASE}/internal/resync-rooms`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret === null ? {} : { "x-aether-internal": secret }),
    },
    body: JSON.stringify({ serverId }),
    signal: AbortSignal.timeout(6000),
  });
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

  const { owner, member, server, defaultRole } = await requireSeedFixture(prisma);
  warnBusyGateway(await connectedClients(BASE));

  section("Revalidacao de sessao em conexao aberta");

  const target = await sessionCookie(member.id);
  const revalidateConn = await connect(target.cookie);
  check("conecta com sessao valida", revalidateConn.ok, revalidateConn.error);

  if (revalidateConn.ok) {
    await prisma.session.update({
      where: { id: target.sessionId },
      data: { revokedAt: new Date() },
    });

    console.log("  ..    sessao revogada; aguardando o guarda periodico (ate 40s)");
    const revoked = waitFor(revalidateConn.socket, "session:revoked", () => true, 40_000);
    const disconnected = new Promise((resolve) => {
      revalidateConn.socket.once("disconnect", () => resolve(true));
      setTimeout(() => resolve(false), 41_000);
    });

    const [sawRevoked, sawDisconnect] = await Promise.all([revoked, disconnected]);
    check("o gateway avisa session:revoked", sawRevoked !== null);
    check("e derruba o socket", sawDisconnect === true);
  }

  section("A rota de recalculo exige o segredo");

  const semSegredo = await resyncRooms(server.id, null);
  check("sem cabecalho de segredo, responde 404", semSegredo.status === 404, `HTTP ${semSegredo.status}`);

  const segredoErrado = await resyncRooms(server.id, "x".repeat(authSecret.length));
  check(
    "com segredo errado, responde 404",
    segredoErrado.status === 404,
    `HTTP ${segredoErrado.status}`,
  );

  section("Recalculo de salas — alargar acesso sem reconectar");

  const channel = await prisma.channel.create({
    data: {
      serverId: server.id,
      name: "verify7b-privado",
      type: "TEXT",
      isPrivate: true,
      position: 999,
    },
    select: { id: true },
  });
  createdChannels.push(channel.id);

  const ownerConn = await connect((await sessionCookie(owner.id)).cookie);
  const memberConn = await connect((await sessionCookie(member.id)).cookie);
  if (!ownerConn.ok || !memberConn.ok) throw new Error("nao conectou");

  await emitWithAck(ownerConn.socket, "server:join", server.id);
  await emitWithAck(memberConn.socket, "server:join", server.id);

  // Canal privado sem overwrite: invisivel. Confirma a base antes de alargar.
  const antesDoAcesso = waitFor(
    memberConn.socket,
    "message:new",
    (p) => p.message.content === "[verify7b] sem-acesso",
  );
  const semAcesso = await emitWithAck(ownerConn.socket, "message:send", {
    channelId: channel.id,
    content: "[verify7b] sem-acesso",
    nonce: "v7b-0",
  });
  if (semAcesso?.ok) createdMessages.push(semAcesso.message.id);
  check(
    "sem overwrite, o membro NAO esta na sala do canal privado",
    (await antesDoAcesso) === null,
  );

  // Espelha packages/shared/src/permissions.ts — scripts .mjs rodam por node
  // puro, sem transformar TypeScript, entao nao importam @aether/shared.
  const VIEW_CHANNEL = 1n << 6n;
  const SEND_MESSAGES = 1n << 10n;

  const overwrite = await prisma.channelOverwrite.create({
    data: {
      channelId: channel.id,
      target: "ROLE",
      roleId: defaultRole.id,
      allow: VIEW_CHANNEL | SEND_MESSAGES,
      deny: 0n,
    },
    select: { id: true },
  });
  createdOverwrites.push(overwrite.id);

  const resyncAlarga = await resyncRooms(server.id, authSecret);
  check("recalculo com o segredo certo e aceito", resyncAlarga.status === 200, `HTTP ${resyncAlarga.status}`);

  const depoisDoAlargue = waitFor(
    memberConn.socket,
    "message:new",
    (p) => p.message.content === "[verify7b] alargado",
  );
  const alargado = await emitWithAck(ownerConn.socket, "message:send", {
    channelId: channel.id,
    content: "[verify7b] alargado",
    nonce: "v7b-1",
  });
  if (alargado?.ok) createdMessages.push(alargado.message.id);
  check(
    "depois do recalculo, o membro passa a receber o canal SEM reconectar",
    (await depoisDoAlargue) !== null,
  );

  section("Recalculo de salas — estreitar acesso sem expulsar do servidor");

  await prisma.channelOverwrite.delete({ where: { id: overwrite.id } });
  createdOverwrites.length = 0; // ja apagado, nao repetir na limpeza

  const resyncEstreita = await resyncRooms(server.id, authSecret);
  check("segundo recalculo tambem e aceito", resyncEstreita.status === 200);

  let vazou = false;
  const leakWatcher = (p) => {
    if (p.message.content === "[verify7b] estreitado") vazou = true;
  };
  memberConn.socket.on("message:new", leakWatcher);

  const ownerAindaVe = waitFor(
    ownerConn.socket,
    "message:new",
    (p) => p.message.content === "[verify7b] estreitado",
  );
  const estreitado = await emitWithAck(ownerConn.socket, "message:send", {
    channelId: channel.id,
    content: "[verify7b] estreitado",
    nonce: "v7b-2",
  });
  if (estreitado?.ok) createdMessages.push(estreitado.message.id);

  check("o dono (ADMINISTRATOR) continua vendo o canal", (await ownerAindaVe) !== null);
  await sleep(900);
  memberConn.socket.off("message:new", leakWatcher);
  check(
    "depois do recalculo, o membro NAO recebe mais o canal — sem ser expulso do servidor",
    !vazou,
  );

  const aindaNoServidor = waitFor(
    memberConn.socket,
    "presence:update",
    () => true,
    500,
  );
  await emitWithAck(memberConn.socket, "presence:set", "ONLINE");
  await aindaNoServidor.catch(() => undefined);
  check(
    "o socket do membro segue aberto (recalculo nao e expulsao)",
    memberConn.socket.connected,
  );

  section("Arvore de canais em tempo real");

  /**
   * O cenario que motivou isto: um admin cria um canal privado e ele so
   * aparece para os outros depois de um F5. O socket ja entrava na sala do
   * canal novo (metade de seguranca, fase 7b), mas a LISTA de canais e
   * renderizada pelo Next e nada avisava o cliente para pedi-la de novo.
   */
  const sawChanged = waitFor(
    memberConn.socket,
    "server:changed",
    (p) => p.serverId === server.id,
  );

  const novo = await prisma.channel.create({
    data: {
      serverId: server.id,
      name: "verify7b-arvore",
      type: "TEXT",
      isPrivate: false,
      position: 998,
    },
    select: { id: true },
  });
  createdChannels.push(novo.id);

  await resyncRooms(server.id, authSecret);
  check(
    "criar canal avisa quem ja esta conectado (server:changed)",
    (await sawChanged) !== null,
  );

  // O aviso vai para a sala do servidor, entao o dono tambem recebe.
  const ownerSawChanged = waitFor(
    ownerConn.socket,
    "server:changed",
    (p) => p.serverId === server.id,
  );
  await resyncRooms(server.id, authSecret);
  check("o aviso alcanca todos do servidor", (await ownerSawChanged) !== null);

  ownerConn.socket.close();
  memberConn.socket.close();
}

try {
  await main();
} catch (error) {
  failed += 1;
  console.log(`\nErro: ${error.message}`);
} finally {
  await prisma.channelOverwrite
    .deleteMany({ where: { id: { in: createdOverwrites } } })
    .catch(() => undefined);
  await prisma.message
    .deleteMany({ where: { id: { in: createdMessages } } })
    .catch(() => undefined);
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
