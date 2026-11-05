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
 * Estagio 4b-2 (moderacao), numa sala do hub criada pelo dono:
 *   3. quem NAO criou a sala nao remove ninguem;
 *   4. o criador remove: o alvo recebe `hub:removido` e NAO consegue voltar
 *      (prazo de espera);
 *   5. quem bloqueou alguem que esta na sala nao entra ("indisponivel").
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
const usuarios = [];
let usuarioId = null;
let socket = null;
const outrosSockets = [];

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

  await moderacao(hub, user.id);
}

/** Cria um membro do hub com o cargo padrao (VIEW_CHANNEL + CONNECT + SPEAK). */
async function membroDoHub(hub, cargoId, sufixo) {
  const u = await prisma.user.create({
    data: {
      username: `${MARCA}-${sufixo}`.slice(0, 24),
      displayName: `Cobaia ${sufixo}`,
      email: `${MARCA}-${sufixo}@local.test`,
      passwordHash: "scrypt$16384$8$1$naoimporta$naoimporta",
    },
    select: { id: true },
  });
  usuarios.push(u.id);
  await prisma.serverMember.create({
    data: { serverId: hub, userId: u.id, roles: { create: [{ roleId: cargoId }] } },
  });
  return u;
}

const entrarVoz = (s, channelId) =>
  new Promise((r) => s.emit("voice:join", { channelId }, r));
const remover = (s, channelId, userId) =>
  new Promise((r) => s.emit("hub:remover", { channelId, userId }, r));

async function moderacao(hub, criadorId) {
  console.log("\nModeracao da sala do hub (4b-2)");
  const PERMS = (1n << 6n) | (1n << 7n) | (1n << 8n); // VIEW_CHANNEL | CONNECT | SPEAK
  const cargo = await prisma.role.create({
    data: { serverId: hub, name: "@todos", isDefault: true, permissions: PERMS },
    select: { id: true },
  });
  const alvo = await membroDoHub(hub, cargo.id, "alvo");
  const bloqueador = await membroDoHub(hub, cargo.id, "bloq");
  const sala = await prisma.channel.create({
    data: {
      serverId: hub,
      name: "Valorant",
      type: "VOICE",
      isTemporary: true,
      jogo: "Valorant",
      criadaPor: criadorId,
      userLimit: 5,
    },
    select: { id: true },
  });

  const sAlvo = await conectar(await cookieDe(alvo.id));
  const sBloq = await conectar(await cookieDe(bloqueador.id));
  outrosSockets.push(sAlvo, sBloq);
  let removido = null;
  sAlvo.on("hub:removido", (p) => (removido = p));

  const jCriador = await entrarVoz(socket, sala.id);
  check("criador entra na propria sala", jCriador?.ok === true, JSON.stringify(jCriador));
  const jAlvo = await entrarVoz(sAlvo, sala.id);
  check("outro membro entra na sala", jAlvo?.ok === true, JSON.stringify(jAlvo));

  const naoCriador = await remover(sAlvo, sala.id, criadorId);
  check("quem NAO criou a sala nao remove ninguem", naoCriador?.ok === false);

  const r = await remover(socket, sala.id, alvo.id);
  check("o criador remove", r?.ok === true, JSON.stringify(r));
  await esperar(500);
  check("o removido recebe hub:removido", removido?.channelId === sala.id);

  const volta = await entrarVoz(sAlvo, sala.id);
  check(
    "o removido NAO volta antes do prazo",
    volta?.ok === false && /removido/i.test(volta?.error ?? ""),
    JSON.stringify(volta),
  );

  await prisma.block.create({ data: { blockerId: bloqueador.id, blockedId: criadorId } });
  const bloq = await entrarVoz(sBloq, sala.id);
  check(
    "quem bloqueou alguem que esta na sala nao entra (sem dizer quem)",
    bloq?.ok === false && /disponivel/i.test(bloq?.error ?? "") && !/Cobaia/.test(bloq?.error ?? ""),
    JSON.stringify(bloq),
  );
}

main()
  .catch((erro) => {
    failed += 1;
    console.error(erro);
  })
  .finally(async () => {
    socket?.close();
    for (const s of outrosSockets) s?.close();
    for (const id of servidores) {
      await prisma.server.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of usuarios) await prisma.user.delete({ where: { id } }).catch(() => undefined);
    if (usuarioId) await prisma.user.delete({ where: { id: usuarioId } }).catch(() => undefined);
    console.log(`\n${passed} ok, ${failed} falhou`);
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
