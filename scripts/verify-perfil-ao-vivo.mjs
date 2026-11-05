/**
 * Perfil ao vivo (`user:profile`) COM O GATEWAY NO AR.
 *
 * Quando alguem troca foto, moldura ou nome, o gateway avisa TODO MUNDO que
 * pode ver esse perfil — e so essas pessoas. Antes, so a call e os amigos eram
 * avisados; quem dividia um servidor sem ser amigo via a foto velha ate reabrir
 * o app.
 *
 * Quatro contas descartaveis:
 *   - dono:     troca o perfil;
 *   - membro:   divide um servidor com o dono, NAO e amigo  -> recebe
 *   - amigo:    amigo do dono, NAO divide servidor          -> recebe
 *   - estranho: nem uma coisa nem outra                     -> NAO recebe
 * E o proprio dono (outro aparelho) tambem recebe.
 *
 * Uso (com "npm run dev:realtime" rodando):
 *   dotenv -e .env -- node scripts/verify-perfil-ao-vivo.mjs
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

const MARCA = `pv${Date.now() % 1_000_000_000}`;
const criados = [];
const sockets = [];
let servidorId = null;

async function criarUsuario(sufixo) {
  const user = await prisma.user.create({
    data: {
      username: `${MARCA}-${sufixo}`.slice(0, 24),
      displayName: `Cobaia ${sufixo}`,
      email: `${MARCA}-${sufixo}@local.test`,
      passwordHash: "scrypt$16384$8$1$naoimporta$naoimporta",
    },
    select: { id: true },
  });
  criados.push(user.id);
  return user;
}

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
    const socket = io(BASE, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { cookie },
      reconnection: false,
      timeout: 5000,
    });
    sockets.push(socket);
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", () => resolve(null));
  });
}

/** Todos os `user:profile` que chegarem a este socket. */
function espiar(socket) {
  const recebidos = [];
  socket.on("user:profile", (p) => recebidos.push(p));
  return recebidos;
}

async function main() {
  const dono = await criarUsuario("dono");
  const membro = await criarUsuario("membro");
  const amigo = await criarUsuario("amigo");
  const estranho = await criarUsuario("estranho");

  const servidor = await prisma.server.create({
    data: {
      name: `${MARCA} perfil`,
      ownerId: dono.id,
      members: { create: [{ userId: dono.id }, { userId: membro.id }] },
    },
    select: { id: true },
  });
  servidorId = servidor.id;
  await prisma.friendship.create({
    data: { requesterId: dono.id, addresseeId: amigo.id, status: "ACCEPTED" },
  });

  const conexoes = await Promise.all(
    [dono, membro, amigo, estranho].map(async (u) => conectar(await cookieDe(u.id))),
  );
  if (conexoes.some((s) => !s)) {
    console.log(`\ngateway fora do ar em ${BASE} — nada a verificar.`);
    return;
  }
  const [sDono, sMembro, sAmigo, sEstranho] = conexoes;
  const recebido = {
    dono: espiar(sDono),
    membro: espiar(sMembro),
    amigo: espiar(sAmigo),
    estranho: espiar(sEstranho),
  };

  // O gateway entra nas salas dos servidores logo depois do `connect`, de
  // forma assincrona (`joinAllServerRooms`).
  await new Promise((r) => setTimeout(r, 800));

  console.log("\nO dono troca nome e foto");
  const novaFoto = `https://example.test/${MARCA}.png`;
  await prisma.user.update({
    where: { id: dono.id },
    data: { displayName: `Novo ${MARCA}`, avatarUrl: novaFoto },
  });
  const resposta = await fetch(`${BASE}/internal/profile-changed`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-aether-internal": process.env.AUTH_SECRET,
    },
    body: JSON.stringify({ userId: dono.id }),
  });
  check("/internal/profile-changed responde 200", resposta.status === 200, `status ${resposta.status}`);

  await new Promise((r) => setTimeout(r, 1200));

  const certo = (lista) =>
    lista.length === 1 &&
    lista[0].user?.id === dono.id &&
    lista[0].user?.displayName === `Novo ${MARCA}` &&
    lista[0].user?.avatarUrl === novaFoto;

  check(
    "membro do mesmo servidor (nao amigo) recebe o perfil novo, uma vez",
    certo(recebido.membro),
    JSON.stringify(recebido.membro),
  );
  check("amigo sem servidor em comum recebe", certo(recebido.amigo), JSON.stringify(recebido.amigo));
  check("o proprio dono (outros aparelhos) recebe", certo(recebido.dono), JSON.stringify(recebido.dono));
  check(
    "quem nao e amigo nem divide servidor NAO recebe",
    recebido.estranho.length === 0,
    JSON.stringify(recebido.estranho),
  );
  check(
    "o evento so carrega campos publicos",
    !recebido.membro[0] ||
      !["email", "passwordHash"].some((k) => k in recebido.membro[0].user),
  );
}

main()
  .catch((erro) => {
    failed += 1;
    console.error(erro);
  })
  .finally(async () => {
    for (const s of sockets) s.close();
    if (servidorId) await prisma.server.delete({ where: { id: servidorId } }).catch(() => undefined);
    for (const id of criados) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    console.log(`\n${passed} ok, ${failed} falhou`);
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
