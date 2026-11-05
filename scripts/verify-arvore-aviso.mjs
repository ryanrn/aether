/**
 * O aviso LEVE de arvore alterada (`soAvisar`) COM O GATEWAY NO AR.
 *
 * Reordenar canal na mesma categoria nao muda quem ve o que, entao o web pede
 * so o aviso (`avisarArvoreMudou`), sem o recalculo de salas — era o recalculo
 * que deixava o arraste de canal levar ~3 s. O que so da para provar em
 * execucao:
 *
 *   1. `soAvisar: true` responde 200 e o `server:changed` CHEGA a quem esta no
 *      servidor (senao a arvore dos outros nao atualizaria);
 *   2. NAO chega a quem nao e membro;
 *   3. o caminho completo (sem `soAvisar`) continua avisando igual.
 *
 * Usa dados descartaveis.
 *
 * Uso (com "npm run dev:realtime" rodando):
 *   dotenv -e .env -- node scripts/verify-arvore-aviso.mjs
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

const MARCA = `av${Date.now() % 1_000_000_000}`;
const usuarios = [];
const sockets = [];
let servidorId = null;

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

async function avisar(body) {
  const r = await fetch(`${BASE}/internal/resync-rooms`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-aether-internal": process.env.AUTH_SECRET,
    },
    body: JSON.stringify(body),
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

async function criarUsuario(sufixo) {
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
  return u;
}

async function main() {
  const membro = await criarUsuario("membro");
  const fora = await criarUsuario("fora");
  const s = await prisma.server.create({
    data: {
      name: `${MARCA} arvore`,
      ownerId: membro.id,
      members: { create: [{ userId: membro.id }] },
    },
    select: { id: true },
  });
  servidorId = s.id;

  const sMembro = await conectar(await cookieDe(membro.id));
  const sFora = await conectar(await cookieDe(fora.id));
  if (!sMembro || !sFora) {
    console.log(`\ngateway fora do ar em ${BASE} — nada a verificar.`);
    return;
  }
  sockets.push(sMembro, sFora);
  const doMembro = espiar(sMembro);
  const deFora = espiar(sFora);
  await esperar(800); // `joinAllServerRooms` roda logo depois do connect

  console.log("\nAviso leve (soAvisar)");
  check("responde 200", (await avisar({ serverId: s.id, soAvisar: true })) === 200);
  await esperar(800);
  check("membro recebe server:changed", doMembro.has(s.id));
  check("quem nao e membro NAO recebe", !deFora.has(s.id));

  console.log("\nCaminho completo (sem soAvisar) continua igual");
  doMembro.clear();
  check("responde 200", (await avisar({ serverId: s.id })) === 200);
  await esperar(800);
  check("membro recebe server:changed", doMembro.has(s.id));
}

main()
  .catch((erro) => {
    failed += 1;
    console.error(erro);
  })
  .finally(async () => {
    for (const so of sockets) so.close();
    if (servidorId) await prisma.server.delete({ where: { id: servidorId } }).catch(() => undefined);
    for (const id of usuarios) await prisma.user.delete({ where: { id } }).catch(() => undefined);
    console.log(`\n${passed} ok, ${failed} falhou`);
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
