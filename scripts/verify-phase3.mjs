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
const createdChannels = [];

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

/**
 * Ticket de handshake: mesmo segredo, publico proprio e `jti` unico.
 * Espelha packages/access/src/tickets.ts.
 */
async function mintTicket(userId, sessionId, { audience = "aether-socket" } = {}) {
  return new SignJWT({ sid: sessionId, jti: Math.random().toString(16).slice(2) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer("aether")
    .setAudience(audience)
    .setExpirationTime("300s")
    .sign(secret);
}

/** Conecta usando ticket no handshake, sem cookie nenhum. */
function connectWithTicket(ticket) {
  return new Promise((resolve) => {
    const socket = io(BASE, {
      path: "/ws",
      transports: ["websocket"],
      auth: { ticket },
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

function sendMessage(socket, payload) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    socket.emit("message:send", payload, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

function requestHistory(socket, payload) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    socket.emit("message:history", payload, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

function joinVoice(socket, channelId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    socket.emit("voice:join", { channelId }, (result) => {
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

  /**
   * Canal privado SEM nenhum overwrite: invisivel para todos menos dono e
   * admin. E o caso que prova que a permissao de canal chega ao gateway.
   */
  const secretChannel = await prisma.channel.create({
    data: {
      serverId: server.id,
      name: "verify-privado",
      type: "TEXT",
      isPrivate: true,
      position: 999,
    },
    select: { id: true },
  });
  createdChannels.push(secretChannel.id);
  const secretChannelId = secretChannel.id;

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

  section("Ticket de handshake (caminho de producao)");

  const ticketSession = await prisma.session.create({
    data: { userId: owner.id, expiresAt: new Date(Date.now() + 3600e3) },
  });
  createdSessions.push(ticketSession.id);

  const ticket = await mintTicket(owner.id, ticketSession.id);
  const byTicket = await connectWithTicket(ticket);
  check("ticket valido conecta sem cookie", byTicket.ok, byTicket.error);
  if (byTicket.ok) {
    track(byTicket.socket);
    byTicket.socket.close();
  }

  // Uso unico: o gateway lembra do jti pelo tempo de vida do ticket.
  const replay = await connectWithTicket(ticket);
  checkRejected("o MESMO ticket nao serve duas vezes", replay);

  // Um cookie de sessao tem publico "aether-app"; nao pode valer como ticket.
  const wrongAudience = await mintTicket(owner.id, ticketSession.id, {
    audience: "aether-app",
  });
  const asTicket = await connectWithTicket(wrongAudience);
  checkRejected("token de sessao nao vale como ticket", asTicket);

  const revokedTicketSession = await prisma.session.create({
    data: {
      userId: owner.id,
      expiresAt: new Date(Date.now() + 3600e3),
      revokedAt: new Date(),
    },
  });
  createdSessions.push(revokedTicketSession.id);
  const revokedTicket = await connectWithTicket(
    await mintTicket(owner.id, revokedTicketSession.id),
  );
  checkRejected("ticket de sessao revogada e recusado", revokedTicket);

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

  section("Chat de texto");

  const textChannel = await prisma.channel.findFirst({
    where: { serverId: server.id, type: "TEXT", isPrivate: false },
  });
  const voiceChannel = await prisma.channel.findFirst({
    where: { serverId: server.id, type: "VOICE", isPrivate: false },
  });
  if (!textChannel || !voiceChannel) {
    console.log("  --    seed sem canal de texto/voz publico; secoes puladas");
  } else {
    const heard = waitFor(
      memberConn.socket,
      "message:new",
      (p) => p.message.content === "[verify] ola",
    );
    const sent = await sendMessage(ownerConn.socket, {
      channelId: textChannel.id,
      content: "[verify] ola",
      nonce: "n-1",
    });
    check("mensagem e aceita", sent?.ok === true, JSON.stringify(sent));
    const received = await heard;
    check("o outro usuario recebe em tempo real", received !== null);
    check(
      "o nonce volta para reconciliar o envio otimista",
      received?.nonce === "n-1",
      JSON.stringify(received?.nonce),
    );
    check(
      "o autor vem completo no payload",
      received?.message?.author?.id === owner.id &&
        typeof received?.message?.author?.username === "string",
      JSON.stringify(received?.message?.author ?? null),
    );
    check(
      "o payload nao vaza o email do autor",
      received != null && !("email" in (received.message.author ?? {})),
    );

    const persisted = await prisma.message.findFirst({
      where: { channelId: textChannel.id, content: "[verify] ola" },
    });
    check("mensagem persiste no Postgres", persisted !== null);

    const empty = await sendMessage(ownerConn.socket, {
      channelId: textChannel.id,
      content: "   ",
      nonce: "n-2",
    });
    check("mensagem vazia e recusada", empty?.ok === false, JSON.stringify(empty));

    const huge = await sendMessage(ownerConn.socket, {
      channelId: textChannel.id,
      content: "x".repeat(5000),
      nonce: "n-3",
    });
    check("mensagem longa demais e recusada", huge?.ok === false);

    const toVoice = await sendMessage(ownerConn.socket, {
      channelId: voiceChannel.id,
      content: "[verify] em canal de voz",
      nonce: "n-4",
    });
    check("canal de voz nao aceita mensagem", toVoice?.ok === false);

    const ghost = await sendMessage(ownerConn.socket, {
      channelId: "cxxxxxxxxxxxxxxxxxxxxxxxx",
      content: "[verify] canal fantasma",
      nonce: "n-5",
    });
    check("canal inexistente e recusado", ghost?.ok === false);

    if (secretChannelId) {
      const forbidden = await sendMessage(memberConn.socket, {
        channelId: secretChannelId,
        content: "[verify] canal privado",
        nonce: "n-6",
      });
      check(
        "sem acesso ao canal privado, o envio e recusado",
        forbidden?.ok === false,
        JSON.stringify(forbidden),
      );
    }

    const history = await requestHistory(ownerConn.socket, {
      channelId: textChannel.id,
    });
    check(
      "historico devolve a mensagem enviada",
      history?.ok === true &&
        history.messages.some((m) => m.content === "[verify] ola"),
      JSON.stringify(history?.ok),
    );

    // Capacidade 8 com reposicao de 2/s: uma rajada de 14 tem de esbarrar.
    let blocked = 0;
    for (let i = 0; i < 14; i += 1) {
      const result = await sendMessage(ownerConn.socket, {
        channelId: textChannel.id,
        content: `[verify] flood ${i}`,
        nonce: `f-${i}`,
      });
      if (result?.ok === false) blocked += 1;
    }
    check("rate limit corta rajada", blocked > 0, `recusadas: ${blocked}`);

    section("Voz (ocupacao, sem midia)");

    const sawJoinVoice = waitFor(
      ownerConn.socket,
      "voice:update",
      (p) =>
        p.participant.userId === member.id &&
        p.participant.channelId === voiceChannel.id,
    );
    const joinedVoice = await joinVoice(memberConn.socket, voiceChannel.id);
    check("entra no canal de voz", joinedVoice?.ok === true, JSON.stringify(joinedVoice));
    check("o outro usuario ve a entrada", (await sawJoinVoice) !== null);
    check(
      "a lista de participantes ja vem no ack",
      joinedVoice?.ok === true &&
        joinedVoice.participants.some((p) => p.userId === member.id),
    );

    const sawSpeaking = waitFor(
      ownerConn.socket,
      "voice:update",
      (p) =>
        p.participant.userId === member.id && p.participant.speaking === true,
    );
    memberConn.socket.emit("voice:speaking", true);
    check("indicador de fala propaga", (await sawSpeaking) !== null);

    const sawMute = waitFor(
      ownerConn.socket,
      "voice:update",
      (p) => p.participant.userId === member.id && p.participant.selfMuted === true,
    );
    memberConn.socket.emit("voice:state", { selfMuted: true });
    const mutePayload = await sawMute;
    check("mute proprio propaga", mutePayload !== null);
    // O gateway impoe isso: cliente reescrito nao consegue aparecer falando
    // enquanto esta mutado.
    check(
      "mutado nunca aparece falando",
      mutePayload?.participant?.speaking === false,
      JSON.stringify(mutePayload?.participant?.speaking),
    );

    const toText = await joinVoice(memberConn.socket, textChannel.id);
    check("canal de texto nao aceita conexao de voz", toText?.ok === false);

    const sawLeaveVoice = waitFor(
      ownerConn.socket,
      "voice:update",
      (p) => p.participant.userId === member.id && p.participant.channelId === null,
    );
    memberConn.socket.emit("voice:leave");
    check("sair da voz propaga", (await sawLeaveVoice) !== null);

    const sawDropVoice = waitFor(
      ownerConn.socket,
      "voice:update",
      (p) => p.participant.userId === member.id && p.participant.channelId === null,
      3000,
    );
    await joinVoice(memberConn.socket, voiceChannel.id);
    memberConn.socket.disconnect();
    memberConn.socket.connect();
    check("queda de conexao tira da voz", (await sawDropVoice) !== null);
    await sleep(300);
    await joinServer(memberConn.socket, server.id);
  }

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
  // As mensagens de teste levam prefixo justamente para a limpeza ser cirurgica.
  await prisma.message
    .deleteMany({ where: { content: { startsWith: "[verify]" } } })
    .catch(() => undefined);
  await prisma.channel
    .deleteMany({ where: { id: { in: createdChannels } } })
    .catch(() => undefined);
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
