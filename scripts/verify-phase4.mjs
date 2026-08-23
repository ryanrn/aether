/**
 * Verificacao da FASE 4 — camada de AUTORIZACAO da midia.
 *
 * O que este script prova: que o token emitido pelo gateway carrega, assinado,
 * exatamente as permissoes que o @aether/access calculou. Quem nao tem SPEAK
 * recebe um token que nao permite publicar microfone, e quem impoe isso passa
 * a ser o proprio SFU.
 *
 * O que este script NAO prova: que o audio chega. Isso exige servidor LiveKit
 * mais dois navegadores, e e teste manual.
 *
 * Uso (com o gateway rodando via "npm run dev:realtime"):
 *   dotenv -e .env -- node scripts/verify-phase4.mjs
 */
import { PrismaClient } from "@prisma/client";
import { SignJWT, jwtVerify, decodeJwt } from "jose";
import { io } from "socket.io-client";
import { connectedClients, requireSeedFixture, warnBusyGateway } from "./lib/fixture.mjs";

const BASE = process.env.VERIFY_REALTIME_URL ?? "http://localhost:4000";
const prisma = new PrismaClient();
const authSecret = new TextEncoder().encode(process.env.AUTH_SECRET);
let passed = 0;
let failed = 0;

/** Bits espelhados de packages/shared/src/permissions.ts */
const PERM = {
  VIEW_CHANNEL: 1n << 6n,
  CONNECT: 1n << 7n,
  SPEAK: 1n << 8n,
  SCREEN_SHARE: 1n << 9n,
};

function check(label, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FALHA ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** O LiveKit serializa as fontes em minusculas; comparamos sem depender disso. */
function sources(grant) {
  return (grant?.canPublishSources ?? []).map((s) => String(s).toLowerCase());
}

function section(name) {
  console.log(`\n${name}`);
}

const createdSessions = [];
const createdChannels = [];

async function sessionCookie(userId) {
  const session = await prisma.session.create({
    data: { userId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
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
    socket.once("connect_error", (error) => {
      socket.close();
      resolve({ ok: false, error: error.message });
    });
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

function joinVoice(socket, channelId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000);
    socket.emit("voice:join", { channelId }, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
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

/** Cria um canal de voz com um overwrite de cargo aplicado. */
async function voiceChannelWithOverwrite(serverId, roleId, { deny }) {
  const channel = await prisma.channel.create({
    data: {
      serverId,
      name: `verify-${Math.random().toString(16).slice(2, 8)}`,
      type: "VOICE",
      position: 900,
      overwrites: {
        create: [{ target: "ROLE", roleId, allow: 0n, deny }],
      },
    },
    select: { id: true },
  });
  createdChannels.push(channel.id);
  return channel.id;
}

async function main() {
  console.log(`Alvo: ${BASE}`);
  await requireGatewayUp();

  const configured = Boolean(
    process.env.LIVEKIT_URL &&
      process.env.LIVEKIT_API_KEY &&
      process.env.LIVEKIT_API_SECRET,
  );
  console.log(
    configured
      ? "LiveKit: configurado"
      : "LiveKit: NAO configurado — so o caminho de degradacao sera testado",
  );

  const { owner, member, server } = await requireSeedFixture(prisma);
  warnBusyGateway(await connectedClients(BASE));

  // O dono curto-circuita para todas as permissoes, entao os testes de
  // restricao precisam de um membro comum.
  const memberRole = await prisma.role.findFirst({
    where: { serverId: server.id, isDefault: true },
    select: { id: true },
  });
  if (!memberRole) {
    console.log("Cargo padrao nao encontrado no servidor de seed.");
    process.exit(1);
  }

  const fullChannel = await voiceChannelWithOverwrite(server.id, memberRole.id, {
    deny: 0n,
  });
  const noSpeakChannel = await voiceChannelWithOverwrite(
    server.id,
    memberRole.id,
    { deny: PERM.SPEAK | PERM.SCREEN_SHARE },
  );
  const noConnectChannel = await voiceChannelWithOverwrite(
    server.id,
    memberRole.id,
    { deny: PERM.CONNECT },
  );

  const conn = await connect(await sessionCookie(member.id));
  if (!conn.ok) throw new Error(`membro nao conectou: ${conn.error}`);
  await joinServer(conn.socket, server.id);

  section("Emissao do token de midia");

  const joined = await joinVoice(conn.socket, fullChannel);
  check("entra no canal de voz", joined?.ok === true, JSON.stringify(joined));

  if (!configured) {
    check(
      "sem LiveKit configurado, o ack vem com media nulo (degradacao limpa)",
      joined?.ok === true && joined.media === null,
      JSON.stringify(joined?.media),
    );
  } else {
    const media = joined?.ok === true ? joined.media : null;
    check("o ack traz credenciais de midia", media !== null);
    check(
      "a URL do SFU vem do servidor, nao do cliente",
      typeof media?.url === "string" && media.url.startsWith("ws"),
      media?.url,
    );

    /**
     * Assinatura: o token so vale se foi emitido com o nosso API secret.
     *
     * A tolerancia de relogio existe porque quem assina (o gateway) e quem
     * verifica (esta maquina) sao computadores diferentes. Sem ela, um relogio
     * local atrasado reprova um token perfeitamente valido — e a mensagem
     * "nbf claim timestamp check failed" nao aponta para a causa.
     *
     * A diferenca real e medida e reportada abaixo, entao um relogio muito
     * errado aparece em vez de ficar escondido pela tolerancia.
     */
    let verified = null;
    try {
      const result = await jwtVerify(
        media.token,
        new TextEncoder().encode(process.env.LIVEKIT_API_SECRET),
        { clockTolerance: 300 },
      );
      verified = result.payload;
    } catch (error) {
      verified = null;
      check("o token esta assinado com o API secret", false, error.message);
    }
    if (verified) check("o token esta assinado com o API secret", true);

    const payload = verified ?? decodeJwt(media.token);
    const grant = payload.video ?? {};

    check(
      "a identidade do token e o usuario da sessao",
      payload.sub === member.id,
      String(payload.sub),
    );
    check(
      "o token vale para a sala DESTE canal",
      grant.room === `channel:${fullChannel}`,
      String(grant.room),
    );
    check("o token permite entrar na sala", grant.roomJoin === true);
    check("o token permite ouvir", grant.canSubscribe === true);
    check(
      "o token expira",
      typeof payload.exp === "number" &&
        typeof payload.nbf === "number" &&
        payload.exp > payload.nbf,
    );

    /**
     * Relogio: quem assina o token e o servidor. Se o relogio DESTA maquina
     * estiver muito fora, o token parece invalido aqui mesmo estando correto
     * la — e o mesmo desvio costuma quebrar chamadas a outros servicos de
     * formas obscuras. Melhor gritar do que deixar a tolerancia esconder.
     */
    const skew = Math.round(payload.nbf - Date.now() / 1000);
    if (Math.abs(skew) > 30) {
      const direcao = skew > 0 ? "ATRASADO" : "adiantado";
      console.log(
        "  aviso  relogio local esta " +
          Math.abs(skew) +
          "s " +
          direcao +
          " em relacao ao servidor",
      );
      console.log(
        "         Windows: Configuracoes > Hora e idioma > Sincronizar agora",
      );
    } else {
      check("relogio local e do servidor estao proximos", true);
    }
    check(
      "o cliente nao pode reescrever os proprios metadados",
      grant.canUpdateOwnMetadata !== true,
    );

    section("Permissao vira grant assinado");

    check(
      "com SPEAK, o token permite publicar microfone",
      grant.canPublish === true && sources(grant).includes("microphone"),
      JSON.stringify(grant.canPublishSources),
    );
    check(
      "com SCREEN_SHARE, a fonte de tela ja vem liberada (fase 5)",
      sources(grant).includes("screen_share"),
      JSON.stringify(grant.canPublishSources),
    );

    const denied = await joinVoice(conn.socket, noSpeakChannel);
    const deniedGrant =
      denied?.ok === true && denied.media
        ? (decodeJwt(denied.media.token).video ?? {})
        : null;
    check(
      "sem SPEAK, ainda entra no canal",
      denied?.ok === true,
      JSON.stringify(denied),
    );
    check(
      "sem SPEAK, o token NAO permite publicar",
      deniedGrant !== null && deniedGrant.canPublish !== true,
      JSON.stringify(deniedGrant?.canPublish),
    );
    check(
      "sem SCREEN_SHARE, a fonte de tela nao esta no token",
      deniedGrant !== null && !sources(deniedGrant).includes("screen_share"),
      JSON.stringify(deniedGrant?.canPublishSources),
    );
  }

  section("Sem permissao nao ha token");

  const refused = await joinVoice(conn.socket, noConnectChannel);
  check(
    "sem CONNECT, a entrada e recusada",
    refused?.ok === false,
    JSON.stringify(refused),
  );
  check(
    "e nenhum token e emitido",
    refused?.ok === false && refused.media === undefined,
  );

  conn.socket.close();
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
