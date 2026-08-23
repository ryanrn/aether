/**
 * Verificacao das amizades COM O GATEWAY NO AR.
 *
 * O `verify-friends.mjs` cobre as regras que moram no banco. Este cobre o que
 * so existe em execucao — e onde um erro nao apareceria no compilador:
 *
 *  - a presenca de um amigo chega sem os dois dividirem servidor nenhum;
 *  - ela chega SEM `serverId` e SEM canal de voz. Esta e a razao de o evento
 *    ser separado do `presence:update`: aquele carrega `serverId`, e entregar
 *    isso a quem nao e membro contaria que o servidor existe;
 *  - invisivel esconde o jogo de verdade, e nao so na tela;
 *  - `/internal/friends-changed` faz o gateway reler a lista, senao aceitar
 *    um pedido so valeria na proxima reconexao dos dois.
 *
 * Cria usuarios descartaveis e os apaga no fim.
 *
 * Uso (com "npm run dev:realtime" rodando):
 *   dotenv -e .env -- node scripts/verify-friends-live.mjs
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

const MARCA = `af${Date.now() % 1_000_000_000}`;
const criados = [];
const sockets = [];

async function criarUsuario(sufixo) {
  const user = await prisma.user.create({
    data: {
      username: `${MARCA}-${sufixo}`.slice(0, 24),
      displayName: `Cobaia ${sufixo}`,
      email: `${MARCA}-${sufixo}@local.test`,
      passwordHash: "scrypt$16384$8$1$naoimporta$naoimporta",
    },
    select: { id: true, username: true },
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
    socket.once("connect", () => resolve({ ok: true, socket }));
    socket.once("connect_error", (erro) =>
      resolve({ ok: false, error: erro.message }),
    );
  });
}

/** Espera UM evento, com prazo. Resolve `null` se nao vier. */
function esperar(socket, evento, ms = 2500) {
  return new Promise((resolve) => {
    const prazo = setTimeout(() => {
      socket.off(evento, aoReceber);
      resolve(null);
    }, ms);
    function aoReceber(payload) {
      clearTimeout(prazo);
      socket.off(evento, aoReceber);
      resolve(payload ?? {});
    }
    socket.on(evento, aoReceber);
  });
}

async function avisarGateway(userIds) {
  const resposta = await fetch(`${BASE}/internal/friends-changed`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-aether-internal": process.env.AUTH_SECRET,
    },
    body: JSON.stringify({ userIds }),
  });
  return resposta.status;
}

async function main() {
  const ana = await criarUsuario("ana");
  const bia = await criarUsuario("bia");

  const rA = await conectar(await cookieDe(ana.id));
  const rB = await conectar(await cookieDe(bia.id));
  if (!rA.ok || !rB.ok) {
    console.log(`\ngateway fora do ar em ${BASE} — nada a verificar.`);
    console.log("suba com: npm run dev:realtime");
    return;
  }
  const A = rA.socket;
  const B = rB.socket;
  console.log(`\ndois usuarios conectados (sem nenhum servidor em comum)\n`);

  console.log("Antes de serem amigos, nada vaza");

  // Espia qualquer friend:presence que chegue em B durante o teste inteiro.
  let ultimaPresencaEmB = null;
  B.on("friend:presence", (p) => (ultimaPresencaEmB = p));

  A.emit("presence:set", "DND");
  const nada = await esperar(B, "friend:presence", 1200);
  check("quem NAO e amigo nao recebe a presenca", nada === null);

  console.log("\nVirar amigo passa a valer sem reconectar");

  const amizade = await prisma.friendship.create({
    data: { requesterId: ana.id, addresseeId: bia.id, status: "ACCEPTED" },
    select: { id: true },
  });

  const mudou = esperar(B, "friend:changed");
  const sync = esperar(B, "friend:sync");
  const status = await avisarGateway([ana.id, bia.id]);
  check("/internal/friends-changed responde 200", status === 200, `respondeu ${status}`);
  check("o amigo recebe friend:changed", (await mudou) !== null);

  const entradas = await sync;
  check("o amigo recebe friend:sync", entradas !== null);
  const daAna = entradas?.entries?.find((e) => e.userId === ana.id);
  check(
    "e a ana ja aparece nele, mesmo tendo conectado antes da amizade",
    daAna !== undefined,
    JSON.stringify(entradas?.entries ?? []),
  );
  check(
    "com o status que ela escolheu (DND), nao com o do banco",
    daAna?.status === "DND",
    `veio ${daAna?.status}`,
  );

  console.log("\nA presenca chega, e sem contar onde a pessoa esta");

  ultimaPresencaEmB = null;
  A.emit("presence:set", "IDLE");
  const idle = await esperar(B, "friend:presence");
  check("mudanca de status chega ao amigo", idle?.entry?.status === "IDLE", JSON.stringify(idle));

  const campos = Object.keys(idle?.entry ?? {}).sort().join(",");
  check(
    "o payload NAO tem serverId (vazaria a existencia do servidor)",
    !("serverId" in (idle ?? {})) && !("serverId" in (idle?.entry ?? {})),
    campos,
  );
  check(
    "o payload NAO tem canal de voz",
    !("channelId" in (idle?.entry ?? {})),
    campos,
  );
  check(
    "leva exatamente os campos previstos",
    campos === "game,gameIcon,gameSince,status,userId",
    campos,
  );

  console.log("\nJogo");

  A.emit("presence:game", { name: "Hollow Knight" });
  const jogo = await esperar(B, "friend:presence");
  check("o amigo ve o jogo", jogo?.entry?.game === "Hollow Knight", JSON.stringify(jogo?.entry));
  check("com o carimbo de quando comecou", typeof jogo?.entry?.gameSince === "string");

  console.log("\nInvisivel esconde de verdade");

  A.emit("presence:set", "OFFLINE");
  const invisivel = await esperar(B, "friend:presence");
  check("o amigo ve OFFLINE", invisivel?.entry?.status === "OFFLINE");
  check(
    "e o nome do jogo NAO viaja junto",
    invisivel?.entry?.game === null,
    `veio ${JSON.stringify(invisivel?.entry?.game)}`,
  );

  // Volta a aparecer, para o teste de desconexao comecar de um estado visivel.
  A.emit("presence:set", "ONLINE");
  await esperar(B, "friend:presence");

  console.log("\nDesconectar avisa o amigo");

  const saiu = esperar(B, "friend:presence");
  A.close();
  const fim = await saiu;
  check("cair da conexao chega como OFFLINE", fim?.entry?.status === "OFFLINE", JSON.stringify(fim));

  console.log("\nDesfazer a amizade fecha a torneira");

  await prisma.friendship.delete({ where: { id: amizade.id } });
  await avisarGateway([ana.id, bia.id]);

  const rA2 = await conectar(await cookieDe(ana.id));
  const A2 = rA2.socket;
  ultimaPresencaEmB = null;
  A2.emit("presence:set", "DND");
  const depois = await esperar(B, "friend:presence", 1200);
  check("ex-amigo nao recebe mais nada", depois === null, JSON.stringify(depois));

  console.log(`\n${passed} passaram, ${failed} falharam`);
}

main()
  .catch((erro) => {
    console.error("\nerro:", erro.message);
    failed += 1;
  })
  .finally(async () => {
    for (const s of sockets) s.close();
    for (const id of criados) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    console.log("usuarios descartaveis removidos");
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
