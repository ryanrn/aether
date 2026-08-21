/**
 * Verificacao da FASE 6 — moderacao.
 *
 * O foco aqui e a superficie nova de seguranca: a porta de servico do gateway
 * (/internal/evict), que o app web chama ao expulsar ou banir alguem.
 *
 * Por que ela importa: o socket entra nas salas de um servidor quando a pessoa
 * entra e nunca recalcula. Sem o despejo, quem foi expulso continuaria
 * recebendo o chat ate recarregar a pagina — acesso indevido, nao tela velha.
 *
 * O que NAO e testado aqui: as server actions de expulsar e banir. Elas sao
 * Server Actions do Next, que nao se chamam de fora do navegador; a logica de
 * hierarquia que elas usam (assertHierarchy) ja e coberta desde a fase 2.
 *
 * Uso (com o gateway rodando):
 *   dotenv -e .env -- node scripts/verify-phase6.mjs
 */
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { io } from "socket.io-client";
import { requireSeedFixture } from "./lib/fixture.mjs";

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

function waitFor(socket, event, predicate = () => true, ms = 2500) {
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

function evict(serverId, userId, secret) {
  return fetch(`${BASE}/internal/evict`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret === null ? {} : { "x-aether-internal": secret }),
    },
    body: JSON.stringify({ serverId, userId }),
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

  const { owner, member, server } = await requireSeedFixture(prisma);
  const channel = await prisma.channel.findFirst({
    where: { serverId: server.id, type: "TEXT", isPrivate: false },
  });
  if (!channel) {
    console.log("Canal de texto publico nao encontrado. Rode: npm run db:seed");
    process.exit(1);
  }

  section("A porta de servico exige o segredo");

  const semSegredo = await evict(server.id, member.id, null);
  check("sem cabecalho de segredo, responde 404", semSegredo.status === 404, `HTTP ${semSegredo.status}`);

  const segredoErrado = await evict(server.id, member.id, "x".repeat(authSecret.length));
  check(
    "com segredo errado, responde 404",
    segredoErrado.status === 404,
    `HTTP ${segredoErrado.status}`,
  );

  const outroTamanho = await evict(server.id, member.id, "curto");
  check(
    "segredo de outro tamanho tambem e recusado",
    outroTamanho.status === 404,
    `HTTP ${outroTamanho.status}`,
  );

  section("Despejo corta o acesso na hora");

  const ownerConn = await connect(await sessionCookie(owner.id));
  const memberConn = await connect(await sessionCookie(member.id));
  if (!ownerConn.ok || !memberConn.ok) throw new Error("nao conectou");
  await emitWithAck(ownerConn.socket, "server:join", server.id);
  await emitWithAck(memberConn.socket, "server:join", server.id);

  // Antes do despejo: o membro recebe o que e enviado no canal.
  const antes = waitFor(
    memberConn.socket,
    "message:new",
    (p) => p.message.content === "[verify6] antes",
  );
  const enviada = await emitWithAck(ownerConn.socket, "message:send", {
    channelId: channel.id,
    content: "[verify6] antes",
    nonce: "v6-1",
  });
  if (enviada?.ok) createdMessages.push(enviada.message.id);
  check("antes do despejo, o membro recebe mensagem do canal", (await antes) !== null);

  const sawEvicted = waitFor(
    memberConn.socket,
    "server:evicted",
    (p) => p.serverId === server.id,
  );
  const despejo = await evict(server.id, member.id, authSecret);
  const body = await despejo.json().catch(() => ({}));
  check("com o segredo certo, o despejo e aceito", despejo.status === 200, `HTTP ${despejo.status}`);
  check("o gateway relata ter afetado o socket", (body.sockets ?? 0) >= 1, JSON.stringify(body));
  check("o cliente e avisado com server:evicted", (await sawEvicted) !== null);

  await sleep(300);

  // Depois do despejo: a mesma mensagem NAO pode chegar.
  let vazou = false;
  const leakWatcher = (p) => {
    if (p.message.content === "[verify6] depois") vazou = true;
  };
  memberConn.socket.on("message:new", leakWatcher);

  const ownerRecebe = waitFor(
    ownerConn.socket,
    "message:new",
    (p) => p.message.content === "[verify6] depois",
  );
  const segunda = await emitWithAck(ownerConn.socket, "message:send", {
    channelId: channel.id,
    content: "[verify6] depois",
    nonce: "v6-2",
  });
  if (segunda?.ok) createdMessages.push(segunda.message.id);

  check("quem ficou continua recebendo", (await ownerRecebe) !== null);
  await sleep(900);
  memberConn.socket.off("message:new", leakWatcher);
  check("quem foi despejado NAO recebe mais o chat do servidor", !vazou);

  section("Moderacao de voz");

  const voiceChannel = await prisma.channel.findFirst({
    where: { serverId: server.id, type: "VOICE", isPrivate: false },
    select: { id: true, name: true },
  });
  const outroVoice = await prisma.channel.findFirst({
    where: {
      serverId: server.id,
      type: "VOICE",
      isPrivate: false,
      id: { not: voiceChannel?.id },
    },
    select: { id: true },
  });

  if (!voiceChannel) {
    console.log("  --    sem canal de voz publico no seed; secao pulada");
  } else {
    // O membro foi despejado acima; reconecta para os testes de voz.
    memberConn.socket.disconnect();
    memberConn.socket.connect();
    await sleep(500);
    await emitWithAck(memberConn.socket, "server:join", server.id);
    await emitWithAck(memberConn.socket, "voice:join", { channelId: voiceChannel.id });

    const sawMute = waitFor(
      ownerConn.socket,
      "voice:update",
      (p) => p.participant.userId === member.id && p.participant.serverMuted === true,
      4000,
    );
    const muteAck = await emitWithAck(ownerConn.socket, "voice:moderate", {
      userId: member.id,
      serverMuted: true,
    });
    check("o dono silencia um membro", muteAck?.ok === true, JSON.stringify(muteAck));
    check("o silenciamento propaga para todos", (await sawMute) !== null);

    // Quem foi silenciado pela moderacao nao pode se dessilenciar sozinho.
    let selfUndo = false;
    const undoWatcher = (p) => {
      if (p.participant.userId === member.id && p.participant.serverMuted === false) {
        selfUndo = true;
      }
    };
    ownerConn.socket.on("voice:update", undoWatcher);
    memberConn.socket.emit("voice:state", { selfMuted: false });
    await sleep(900);
    ownerConn.socket.off("voice:update", undoWatcher);
    check("o silenciado nao se liberta pelo proprio controle", !selfUndo);

    const semPermissao = await emitWithAck(memberConn.socket, "voice:moderate", {
      userId: owner.id,
      serverMuted: true,
    });
    check(
      "membro comum nao silencia o dono",
      semPermissao?.ok === false,
      JSON.stringify(semPermissao),
    );

    const proprio = await emitWithAck(ownerConn.socket, "voice:moderate", {
      userId: owner.id,
      serverMuted: true,
    });
    check("ninguem se silencia pela moderacao", proprio?.ok === false);

    const desfaz = await emitWithAck(ownerConn.socket, "voice:moderate", {
      userId: member.id,
      serverMuted: false,
    });
    check("o dono devolve o microfone", desfaz?.ok === true);

    if (outroVoice) {
      const sawMove = waitFor(
        ownerConn.socket,
        "voice:update",
        (p) =>
          p.participant.userId === member.id &&
          p.participant.channelId === outroVoice.id,
        4000,
      );
      const movedEvent = waitFor(memberConn.socket, "voice:moved", () => true, 4000);
      const moveAck = await emitWithAck(ownerConn.socket, "voice:move", {
        userId: member.id,
        channelId: outroVoice.id,
      });
      check("o dono move alguem de canal", moveAck?.ok === true, JSON.stringify(moveAck));
      check("a mudanca de canal propaga", (await sawMove) !== null);
      check("quem foi movido recebe credenciais do canal novo", (await movedEvent) !== null);

      const semMover = await emitWithAck(memberConn.socket, "voice:move", {
        userId: owner.id,
        channelId: voiceChannel.id,
      });
      check("membro comum nao move o dono", semMover?.ok === false);
    } else {
      console.log("  --    so ha um canal de voz no seed; teste de mover pulado");
    }

    memberConn.socket.emit("voice:leave");
    await sleep(200);
  }

  section("Despejo nao atinge quem nao deveria");

  // O dono continua no servidor: despejar o membro nao pode ter mexido nele.
  const aindaDentro = waitFor(
    ownerConn.socket,
    "message:new",
    (p) => p.message.content === "[verify6] terceira",
  );
  const terceira = await emitWithAck(ownerConn.socket, "message:send", {
    channelId: channel.id,
    content: "[verify6] terceira",
    nonce: "v6-3",
  });
  if (terceira?.ok) createdMessages.push(terceira.message.id);
  check("o dono segue nas salas do servidor", (await aindaDentro) !== null);

  ownerConn.socket.close();
  memberConn.socket.close();
}

try {
  await main();
} catch (error) {
  failed += 1;
  console.log(`\nErro: ${error.message}`);
} finally {
  await prisma.message
    .deleteMany({ where: { id: { in: createdMessages } } })
    .catch(() => undefined);
  await prisma.session
    .deleteMany({ where: { id: { in: createdSessions } } })
    .catch(() => undefined);
  await prisma.$disconnect();
}

console.log(`\n${passed} passaram, ${failed} falharam`);
process.exit(failed ? 1 : 0);
