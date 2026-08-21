/**
 * Verificacao da FASE 3.
 *
 * Cobre o handshake e a presenca. Cresce conforme a fase avanca (chat, voz).
 *
 * Usa o socket.io-client de verdade, com cookie real de sessao criado no banco:
 * assim testa o mesmo caminho que o navegador percorre, em vez de uma
 * reimplementacao do protocolo.
 *
 * Uso (com o gateway rodando via "npm run dev:realtime"):
 *   dotenv -e .env -- node scripts/verify-phase3.mjs
 */
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { io } from "socket.io-client";

const BASE = process.env.VERIFY_REALTIME_URL ?? "http://localhost:4000";
const prisma = new PrismaClient();
const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
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

function section(name) {
  console.log(`\n${name}`);
}

const createdSessions = [];

async function sessionCookie(userId, { revoked = false } = {}) {
  const session = await prisma.session.create({
    data: { userId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  createdSessions.push(session.id);
  if (revoked) {
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
  }
  const token = await new SignJWT({ sid: session.id })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer("aether")
    .setAudience("aether-app")
    .setExpirationTime("1h")
    .sign(secret);
  return `aether_session=${token}`;
}

/** Conecta e resolve com o socket pronto, ou com o motivo da recusa. */
function connect(cookie) {
  return new Promise((resolve) => {
    const socket = io(BASE, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: cookie ? { cookie } : {},
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

/** Espera um evento que satisfaca o predicado, com prazo. */
function waitFor(socket, event, predicate = () => true, ms = 4000) {
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

function joinServer(socket, serverId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    socket.emit("server:join", serverId, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Recusa do middleware de autenticacao tem motivo "unauthorized". Qualquer
 * outro motivo ("websocket error", "xhr poll error") significa que o gateway
 * esta fora do ar — e um teste que fica verde com o servico morto e pior do
 * que nenhum teste.
 */
function checkRejected(label, result) {
  check(
    label,
    result.ok === false && result.error === "unauthorized",
    result.ok
      ? "conectou quando nao devia"
      : `motivo inesperado: ${result.error}`,
  );
}

/** O gateway precisa estar vivo antes de qualquer teste rodar. */
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
  if (!owner || !member) {
    console.log("Usuarios de seed nao encontrados. Rode: npm run db:seed");
    process.exit(1);
  }
  const server = await prisma.server.findFirst({ where: { ownerId: owner.id } });
  if (!server) {
    console.log("Servidor de seed nao encontrado. Rode: npm run db:seed");
    process.exit(1);
  }
  const foreign = await prisma.server.findFirst({
    where: {
      ownerId: { not: owner.id },
      members: { none: { userId: owner.id } },
    },
  });

  const openSockets = [];
  const track = (socket) => {
    openSockets.push(socket);
    return socket;
  };

  section("Handshake");

  const anon = await connect(null);
  checkRejected("sem cookie, handshake e recusado", anon);

  const malformed = await connect("aether_session=nao.e.um.jwt");
  checkRejected("token malformado e recusado", malformed);

  const forgedToken = await new SignJWT({ sid: "x" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(owner.id)
    .setIssuedAt()
    .setIssuer("aether")
    .setAudience("aether-app")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode("z".repeat(48)));
  const forged = await connect(`aether_session=${forgedToken}`);
  checkRejected("assinatura de outro segredo e recusada", forged);

  const revoked = await connect(
    await sessionCookie(owner.id, { revoked: true }),
  );
  checkRejected("sessao revogada no banco e recusada", revoked);

  const ownerConn = await connect(await sessionCookie(owner.id));
  check("sessao valida conecta", ownerConn.ok, ownerConn.error);
  if (!ownerConn.ok) throw new Error("sem conexao valida, o resto nao roda");
  track(ownerConn.socket);

  const ready = await waitFor(ownerConn.socket, "ready");
  check(
    "evento ready identifica o usuario certo",
    ready?.user?.id === owner.id && ready?.user?.username === owner.username,
    JSON.stringify(ready?.user ?? null),
  );
  check(
    "ready nao vaza o email do usuario",
    ready != null && !("email" in (ready.user ?? {})),
    JSON.stringify(ready?.user ?? null),
  );

  section("Entrada no servidor");

  const joined = await joinServer(ownerConn.socket, server.id);
  check("dono entra no servidor", joined?.ok === true, JSON.stringify(joined));
  check(
    "a propria presenca ja vem na resposta",
    joined?.ok === true && joined.presence.some((e) => e.userId === owner.id),
    JSON.stringify(joined?.presence ?? null),
  );

  const bogus = await joinServer(ownerConn.socket, "cxxxxxxxxxxxxxxxxxxxxxxxx");
  check(
    "servidor inexistente e recusado",
    bogus?.ok === false,
    JSON.stringify(bogus),
  );

  if (foreign) {
    const notMember = await joinServer(ownerConn.socket, foreign.id);
    check(
      "servidor do qual nao e membro e recusado",
      notMember?.ok === false,
      JSON.stringify(notMember),
    );
  } else {
    // Pular em silencio esconderia uma lacuna de cobertura.
    console.log(
      "  --    servidor do qual nao e membro: sem caso no seed, teste nao rodou",
    );
  }

  section("Presenca entre usuarios");

  const memberConn = await connect(await sessionCookie(member.id));
  check("segundo usuario conecta", memberConn.ok, memberConn.error);
  if (!memberConn.ok) throw new Error("sem o segundo usuario, o resto nao roda");
  track(memberConn.socket);

  const sawJoin = waitFor(
    ownerConn.socket,
    "presence:update",
    (p) => p.entry.userId === member.id && p.entry.status !== "OFFLINE",
  );
  await joinServer(memberConn.socket, server.id);
  check("dono ve o outro usuario ficar online", (await sawJoin) !== null);

  const sawStatus = waitFor(
    ownerConn.socket,
    "presence:update",
    (p) => p.entry.userId === member.id && p.entry.status === "DND",
  );
  memberConn.socket.emit("presence:set", "DND");
  check("mudanca de status propaga", (await sawStatus) !== null);

  await sleep(400);
  const persisted = await prisma.user.findUnique({
    where: { id: member.id },
    select: { status: true },
  });
  check(
    "status escolhido persiste no banco",
    persisted?.status === "DND",
    persisted?.status,
  );

  section("Mesma pessoa em varias abas");

  const secondTab = await connect(await sessionCookie(member.id));
  if (!secondTab.ok) throw new Error("segunda aba nao conectou");
  track(secondTab.socket);
  await joinServer(secondTab.socket, server.id);

  let sawFalseOffline = false;
  const watcher = (payload) => {
    if (
      payload.entry.userId === member.id &&
      payload.entry.status === "OFFLINE"
    ) {
      sawFalseOffline = true;
    }
  };
  ownerConn.socket.on("presence:update", watcher);

  secondTab.socket.close();
  await sleep(800);
  check("fechar UMA aba nao marca o usuario como offline", !sawFalseOffline);

  const sawRealOffline = waitFor(
    ownerConn.socket,
    "presence:update",
    (p) => p.entry.userId === member.id && p.entry.status === "OFFLINE",
  );
  memberConn.socket.close();
  check("fechar a ULTIMA aba marca offline", (await sawRealOffline) !== null);
  ownerConn.socket.off("presence:update", watcher);

  for (const socket of openSockets) socket.close();
}

try {
  await main();
} catch (error) {
  failed += 1;
  console.log(`\nErro: ${error.message}`);
} finally {
  await prisma.user
    .updateMany({ where: { username: "joao" }, data: { status: "OFFLINE" } })
    .catch(() => undefined);
  await prisma.session
    .deleteMany({ where: { id: { in: createdSessions } } })
    .catch(() => undefined);
  await prisma.$disconnect();
}

console.log(`\n${passed} passaram, ${failed} falharam`);
process.exit(failed ? 1 : 0);
