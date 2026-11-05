/**
 * Hub global (fase 2, estagio 4b-1) COM O GATEWAY NO AR.
 *
 * O que so da para provar em execucao: o socket de quem e membro do hub NAO
 * entra na sala do hub ao conectar (`joinAllServerRooms` pula `hub = true`).
 * Sem isso, cada evento do hub iria para toda a base online.
 *
 *   1. membro de um servidor comum e do hub, conectado, sem abrir nada:
 *      `server:changed` do servidor comum CHEGA; o do hub NAO;
 *   2. depois de `server:join` no hub (abrir a tela dele), o do hub CHEGA.
 *
 * Os requisitos de entrada (idade, e-mail, ban) sao do web e tem teste
 * unitario (`tests/unit/hub-acesso.test.ts`).
 *
 * Usa dados descartaveis. Se o banco ja tiver um hub (indice unico), pula —
 * nao mexe no hub de ninguem.
 *
 * Uso (com "npm run dev:realtime" rodando):
 *   dotenv -e .env -- node scripts/verify-hub.mjs
 */
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { io } from "socket.io-client";

const BASE = process.env.VERIFY_REALTIME_URL ?? "http://localhost:4000";
const prisma = new PrismaClient();
const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
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

const MARCA = `hb${Date.now() % 1_000_000_000}`;
const servidores = [];
let usuarioId = null;
let socket = null;

async function cookieDe(userId) {
  const sessao = await prisma.session.create({
    data: { userId, expiresAt: new Date(Date.now() + 3600_000) },
  });
  const token = await new SignJWT({ sid: sessao.id })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer("aether")
    .setAudience("aether-app")
    .setExpirationTime("1h")
    .sign(secret);
  return `aether_session=${token}`;
}

function conectar(cookie) {
  return new Promise((resolve) => {
    const s = io(BASE, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { cookie },
      reconnection: false,
      timeout: 5000,
    });
    s.once("connect", () => resolve(s));
    s.once("connect_error", () => resolve(null));
  });
}

async function avisarMudanca(serverId) {
  const r = await fetch(`${BASE}/internal/resync-rooms`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-aether-internal": process.env.AUTH_SECRET,
    },
    body: JSON.stringify({ serverId }),
  });
  return r.status;
}

/** Os `server:changed` que chegam, por servidor. */
function espiar(s) {
  const recebidos = new Set();
  s.on("server:changed", ({ serverId }) => recebidos.add(serverId));
  return recebidos;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (await prisma.server.findFirst({ where: { hub: true }, select: { id: true } })) {
    console.log("\neste banco ja tem um hub — pulando para nao mexer nele.");
    return;
  }

  const user = await prisma.user.create({
    data: {
      username: `${MARCA}-u`.slice(0, 24),
      displayName: "Cobaia hub",
      email: `${MARCA}@local.test`,
      passwordHash: "scrypt$16384$8$1$naoimporta$naoimporta",
    },
    select: { id: true },
  });
  usuarioId = user.id;

  for (const hub of [false, true]) {
    const s = await prisma.server.create({
      data: {
        name: `${MARCA} ${hub ? "hub" : "comum"}`,
        ownerId: user.id,
        hub,
        members: { create: [{ userId: user.id }] },
      },
      select: { id: true },
    });
    servidores.push(s.id);
  }
  const [comum, hub] = servidores;

  socket = await conectar(await cookieDe(user.id));
  if (!socket) {
    console.log(`\ngateway fora do ar em ${BASE} — nada a verificar.`);
    return;
  }
  const recebidos = espiar(socket);
  await esperar(800); // `joinAllServerRooms` roda logo depois do connect

  console.log("\nConectado, sem abrir nada");
  check("aviso de mudanca aceito pelo gateway", (await avisarMudanca(comum)) === 200);
  await avisarMudanca(hub);
  await esperar(800);
  check("servidor comum: o evento chega (entrou na sala ao conectar)", recebidos.has(comum));
  check(
    "hub: o evento NAO chega (o hub fica fora do joinAllServerRooms)",
    !recebidos.has(hub),
  );

  console.log("\nAbrindo o hub (server:join)");
  const ack = await new Promise((r) => socket.emit("server:join", hub, r));
  check("server:join no hub aceito (membro)", ack?.ok === true, JSON.stringify(ack));
  recebidos.clear();
  await avisarMudanca(hub);
  await esperar(800);
  check("hub aberto: agora o evento chega", recebidos.has(hub));
}

main()
  .catch((erro) => {
    failed += 1;
    console.error(erro);
  })
  .finally(async () => {
    socket?.close();
    for (const id of servidores) {
      await prisma.server.delete({ where: { id } }).catch(() => undefined);
    }
    if (usuarioId) await prisma.user.delete({ where: { id: usuarioId } }).catch(() => undefined);
    console.log(`\n${passed} ok, ${failed} falhou`);
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
