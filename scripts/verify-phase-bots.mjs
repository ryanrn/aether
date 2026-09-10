/**
 * Verificacao AO VIVO da AETHER Developer Platform (bots + webhooks).
 *
 * Os testes unitarios (tests/unit/*.test.ts) cobrem a regra com mocks. Este
 * script cobre o que so existe em EXECUCAO, contra os servicos de verdade:
 *
 *  - a REST v1 responde 401/404/400/201 pelos motivos certos, com HTTP real;
 *  - a autorizacao do bot e a MESMA da arvore de canais humana (canal privado
 *    que o cargo do bot nao alcanca nao aparece e nao deixa ler);
 *  - o corpo do POST nao manda no destino nem no autor (o token/URL manda);
 *  - o namespace /gateway entrega `ready` e `MESSAGE_CREATE` so para o canal
 *    que o bot enxerga, e nada para o app que nao esta instalado;
 *  - o webhook publica pelo mesmo cano, recusa token errado com 404 e tem
 *    rate limit proprio.
 *
 * Cria um servidor, cargos, canais, aplicacoes, bots e webhooks DESCARTAVEIS
 * (prefixo unico) e apaga tudo no fim. NAO toca em nenhuma conta ou servidor
 * real, nao roda seed.
 *
 * Uso (com os dois servicos no ar):
 *   dotenv -e .env -- node scripts/verify-phase-bots.mjs
 *
 * Contra producao:
 *   VERIFY_BASE_URL=https://aether-mocha-phi.vercel.app \
 *   VERIFY_REALTIME_URL=https://aether-gateway-earnest-dew-229.fly.dev \
 *   dotenv -e .env -- node scripts/verify-phase-bots.mjs
 */
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { io } from "socket.io-client";

const BASE = (process.env.VERIFY_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const REALTIME = (process.env.VERIFY_REALTIME_URL ?? "http://localhost:4000").replace(/\/$/, "");
const SECRET = process.env.AUTH_SECRET;

const prisma = new PrismaClient();

const VIEW = 1n << 6n;
const SEND = 1n << 10n;
const ADMIN = 1n << 0n;

let passed = 0;
let failed = 0;

function check(rotulo, ok, detalhe = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${rotulo}`);
  } else {
    failed += 1;
    console.log(`  FALHA ${rotulo}${detalhe ? ` -- ${detalhe}` : ""}`);
  }
}

function sha256(texto) {
  return createHash("sha256").update(texto).digest("hex");
}

/** Mesmo formato de `gerarTokenDeBot` em @aether/access. */
function tokenDeBot() {
  const token = "aeb_" + randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256(token), prefixo: token.slice(0, 12) };
}

// --- HTTP ------------------------------------------------------------------

async function api(metodo, path, token, corpo) {
  const resposta = await fetch(`${BASE}${path}`, {
    method: metodo,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(corpo !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    redirect: "manual",
  });
  let json = null;
  try {
    json = await resposta.json();
  } catch {
    // rota inexistente devolve HTML; deixa null
  }
  return { status: resposta.status, json, headers: resposta.headers };
}

const apiGet = (path, token) => api("GET", path, token);
const apiPost = (path, token, corpo) => api("POST", path, token, corpo);

async function webhookPost(id, token, corpo) {
  const resposta = await fetch(`${BASE}/api/v1/webhooks/${id}/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
    redirect: "manual",
  });
  let json = null;
  try {
    json = await resposta.json();
  } catch {
    /* vazio */
  }
  return { status: resposta.status, json };
}

/**
 * Publica no lugar de um usuario humano, pela rota interna do gateway (a mesma
 * que a REST de bot usa). Autenticada pelo AUTH_SECRET. E como o teste simula
 * "alguem mandou uma mensagem no canal" sem abrir um segundo socket humano.
 */
async function postarComo(atorUserId, conversationId, content) {
  const resposta = await fetch(`${REALTIME}/internal/send-message`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-aether-internal": SECRET },
    body: JSON.stringify({ atorUserId, conversationId, content }),
  });
  let json = null;
  try {
    json = await resposta.json();
  } catch {
    /* vazio */
  }
  return { status: resposta.status, json };
}

// --- Gateway de bot ------------------------------------------------------------

function conectarBot(token, intents) {
  return new Promise((resolve) => {
    const socket = io(`${REALTIME}/gateway`, {
      path: "/ws",
      transports: ["websocket"],
      reconnection: false,
      timeout: 6000,
      auth: intents ? { token, intents } : { token },
    });
    socket.once("ready", (payload) => resolve({ ok: true, socket, ready: payload }));
    socket.once("connect_error", (erro) => {
      socket.close();
      resolve({ ok: false, error: erro.message });
    });
    setTimeout(() => resolve({ ok: false, error: "sem ready em 8s", socket }), 8000);
  });
}

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- fixture --------------------------------------------------------------

const MARCA = `vbot${Date.now().toString(36)}`;
const lixo = { users: [], servers: [], apps: [], sockets: [] };

async function criarUsuario(sufixo, kind = "HUMAN") {
  const u = await prisma.user.create({
    data: {
      username: `${MARCA}${sufixo}`.toLowerCase().slice(0, 24),
      displayName: `${sufixo} ${MARCA}`,
      kind,
      ...(kind === "HUMAN"
        ? {
            email: `${MARCA}-${sufixo}@local.test`,
            passwordHash: "scrypt$16384$8$1$naoimporta$naoimporta",
          }
        : { allowServerDms: false, allowServerFriendRequests: false }),
    },
    select: { id: true, username: true },
  });
  lixo.users.push(u.id);
  return u;
}

async function habilitarApp(sufixo, ownerId) {
  const app = await prisma.application.create({
    data: { ownerId, name: `${MARCA}-${sufixo}` },
    select: { id: true },
  });
  lixo.apps.push(app.id);
  const bot = await criarUsuario(`${sufixo}bot`, "BOT");
  await prisma.application.update({ where: { id: app.id }, data: { botUserId: bot.id } });
  const { token, tokenHash, prefixo } = tokenDeBot();
  await prisma.botToken.create({ data: { applicationId: app.id, tokenHash, prefixo } });
  return { appId: app.id, botId: bot.id, token };
}

/** Replica `instalarBot` de apps/web/.../services/instalacao.ts. */
async function instalar(appId, serverId, botId, roleId, installedBy) {
  await prisma.installation.create({
    data: { applicationId: appId, serverId, installedBy, scopes: ["messages"] },
  });
  const membro = await prisma.serverMember.create({
    data: { serverId, userId: botId },
    select: { id: true },
  });
  await prisma.memberRole.create({ data: { memberId: membro.id, roleId } });
}

async function main() {
  if (!SECRET) {
    console.log("AUTH_SECRET ausente. Rode via: dotenv -e .env -- node scripts/verify-phase-bots.mjs");
    process.exit(1);
  }
  console.log(`\nREST   ${BASE}`);
  console.log(`gateway ${REALTIME}\n`);

  // -- fixture --
  const dono = await criarUsuario("dono");
  const forasteiro = await criarUsuario("fora");

  const server = await prisma.server.create({
    data: { name: `${MARCA}-srv`, ownerId: dono.id },
    select: { id: true, name: true },
  });
  lixo.servers.push(server.id);

  const cargoDono = await prisma.role.create({
    data: { serverId: server.id, name: "dono", isOwner: true, position: 100, permissions: ADMIN },
    select: { id: true },
  });
  const cargoMembro = await prisma.role.create({
    data: {
      serverId: server.id,
      name: "membros",
      isDefault: true,
      position: 1,
      permissions: VIEW | SEND,
    },
    select: { id: true },
  });
  const cargoStaff = await prisma.role.create({
    data: { serverId: server.id, name: "staff", position: 50, permissions: VIEW | SEND },
    select: { id: true },
  });

  const donoMembro = await prisma.serverMember.create({
    data: { serverId: server.id, userId: dono.id },
    select: { id: true },
  });
  await prisma.memberRole.create({ data: { memberId: donoMembro.id, roleId: cargoDono.id } });

  const foraMembro = await prisma.serverMember.create({
    data: { serverId: server.id, userId: forasteiro.id },
    select: { id: true },
  });
  await prisma.memberRole.create({ data: { memberId: foraMembro.id, roleId: cargoMembro.id } });

  const geral = await prisma.channel.create({
    data: { serverId: server.id, name: "geral", type: "TEXT", position: 0 },
    select: { id: true },
  });
  const privado = await prisma.channel.create({
    data: {
      serverId: server.id,
      name: "privado",
      type: "TEXT",
      isPrivate: true,
      position: 1,
      overwrites: {
        create: [{ target: "ROLE", roleId: cargoStaff.id, allow: VIEW | SEND, deny: 0n }],
      },
    },
    select: { id: true },
  });

  const A = await habilitarApp("a", dono.id); // vai ser instalado
  const B = await habilitarApp("b", dono.id); // nunca instalado — controle de isolamento

  try {
    // ================================================================
    console.log("Token e identidade");
    // ================================================================
    check("token lixo -> 401", (await apiGet("/api/v1/users/me", "aeb_naoexiste")).status === 401);

    const me = await apiGet("/api/v1/users/me", A.token);
    check("token valido -> 200", me.status === 200, `status ${me.status}`);
    check(
      "  a identidade e a do bot da aplicacao",
      me.json?.id === A.botId && me.json?.kind === "BOT" && me.json?.applicationId === A.appId,
      JSON.stringify(me.json),
    );

    // ================================================================
    console.log("\nAntes de instalar, o servidor nao existe para o bot");
    // ================================================================
    check(
      "GET /servers/:id -> 404",
      (await apiGet(`/api/v1/servers/${server.id}`, A.token)).status === 404,
    );
    check(
      "GET /servers/:id/channels -> 404",
      (await apiGet(`/api/v1/servers/${server.id}/channels`, A.token)).status === 404,
    );
    check(
      "GET /channels/:id/messages -> 404",
      (await apiGet(`/api/v1/channels/${geral.id}/messages`, A.token)).status === 404,
    );

    // -- instala o app A (bot vira ServerMember com o cargo padrao) --
    await instalar(A.appId, server.id, A.botId, cargoMembro.id, dono.id);

    // ================================================================
    console.log("\nDepois de instalar");
    // ================================================================
    const srv = await apiGet(`/api/v1/servers/${server.id}`, A.token);
    check("GET /servers/:id -> 200", srv.status === 200, `status ${srv.status}`);
    check("  com nome e id certos", srv.json?.id === server.id && srv.json?.name === server.name);

    const canais = await apiGet(`/api/v1/servers/${server.id}/channels`, A.token);
    const ids = Array.isArray(canais.json) ? canais.json.map((c) => c.id) : [];
    check("GET /servers/:id/channels -> 200", canais.status === 200);
    check("  lista o canal publico", ids.includes(geral.id), JSON.stringify(ids));
    check(
      "  NAO lista o canal privado que o cargo do bot nao alcanca",
      !ids.includes(privado.id),
      JSON.stringify(ids),
    );

    const hist = await apiGet(`/api/v1/channels/${geral.id}/messages`, A.token);
    check(
      "GET /channels/geral/messages -> 200 com { messages, hasMore }",
      hist.status === 200 && Array.isArray(hist.json?.messages),
      `status ${hist.status}`,
    );
    check(
      "GET /channels/privado/messages -> 404 (bot nao ve)",
      (await apiGet(`/api/v1/channels/${privado.id}/messages`, A.token)).status === 404,
    );

    // ================================================================
    console.log("\nIsolamento entre aplicacoes");
    // ================================================================
    check(
      "token do app B (nao instalado) no servidor de A -> 404",
      (await apiGet(`/api/v1/servers/${server.id}`, B.token)).status === 404,
    );
    check(
      "serverId trocado por um inexistente -> 404",
      (await apiGet(`/api/v1/servers/srv_${randomBytes(8).toString("hex")}`, A.token)).status === 404,
    );
    check(
      "canal privado com o token do app B -> 404",
      (await apiGet(`/api/v1/channels/${privado.id}/messages`, B.token)).status === 404,
    );

    // ================================================================
    console.log("\nBot publica mensagem (REST -> gateway)");
    // ================================================================
    const envio = await apiPost(`/api/v1/channels/${geral.id}/messages`, A.token, {
      content: `ola do bot ${MARCA}`,
      // campos que o cliente NAO deve conseguir usar para redirecionar:
      serverId: "srv_falso",
      authorId: forasteiro.id,
      channelId: privado.id,
    });
    check("POST /channels/geral/messages -> 201", envio.status === 201, `status ${envio.status}`);
    if (envio.json?.id) {
      const msg = await prisma.message.findUnique({
        where: { id: envio.json.id },
        select: { channelId: true, authorId: true },
      });
      check("  a mensagem caiu no canal da URL, nao no `channelId` do corpo", msg?.channelId === geral.id);
      check("  o autor e o bot, nao o `authorId` do corpo", msg?.authorId === A.botId);
    }

    check(
      "conteudo vazio -> 400",
      (await apiPost(`/api/v1/channels/${geral.id}/messages`, A.token, { content: "   " })).status === 400,
    );
    const noPrivado = await apiPost(`/api/v1/channels/${privado.id}/messages`, A.token, {
      content: "nao deveria entrar",
    });
    check(
      "enviar no canal privado -> recusado (>=400, nunca 201)",
      noPrivado.status >= 400 && noPrivado.status !== 201,
      `status ${noPrivado.status}`,
    );

    // ================================================================
    console.log("\nGateway: ready + MESSAGE_CREATE");
    // ================================================================
    const conexaoA = await conectarBot(A.token);
    if (conexaoA.socket) lixo.sockets.push(conexaoA.socket);
    check("bot instalado conecta e recebe `ready`", conexaoA.ok, conexaoA.error ?? "");
    if (conexaoA.ok) {
      check(
        "  `ready` traz a aplicacao e o servidor instalado",
        conexaoA.ready.application?.id === A.appId &&
          conexaoA.ready.servers?.some((s) => s.id === server.id),
        JSON.stringify(conexaoA.ready),
      );
    }

    const conexaoB = await conectarBot(B.token);
    if (conexaoB.socket) lixo.sockets.push(conexaoB.socket);
    check("bot do app B tambem conecta", conexaoB.ok, conexaoB.error ?? "");
    if (conexaoB.ok) {
      check(
        "  mas `ready` dele nao lista servidor nenhum",
        (conexaoB.ready.servers ?? []).length === 0,
        JSON.stringify(conexaoB.ready.servers),
      );
    }

    if (conexaoA.ok) {
      const recebidasA = [];
      conexaoA.socket.on("dispatch", (p) => {
        if (p?.t === "MESSAGE_CREATE") recebidasA.push(p.d);
      });
      const recebidasB = [];
      if (conexaoB.ok) {
        conexaoB.socket.on("dispatch", (p) => {
          if (p?.t === "MESSAGE_CREATE") recebidasB.push(p.d);
        });
      }

      const marcaGeral = `no geral ${MARCA} ${Date.now()}`;
      const pub = await postarComo(forasteiro.id, geral.id, marcaGeral);
      check("humano posta no canal publico (via /internal/send-message)", pub.json?.ok === true, JSON.stringify(pub.json));
      await esperar(2500);

      const noGeral = recebidasA.find((d) => d.content === marcaGeral);
      check("o bot recebe MESSAGE_CREATE do canal que enxerga", noGeral !== undefined);
      if (noGeral) {
        check("  com channelId e serverId certos", noGeral.channelId === geral.id && noGeral.serverId === server.id);
        check(
          "  autor = o humano, marcado como nao-bot",
          noGeral.author?.id === forasteiro.id && noGeral.author?.bot === false,
          JSON.stringify(noGeral.author),
        );
      }
      check("o bot do app B NAO recebe nada (nao esta em sala nenhuma)", recebidasB.length === 0);

      const marcaPriv = `segredo ${MARCA} ${Date.now()}`;
      await postarComo(dono.id, privado.id, marcaPriv);
      await esperar(2500);
      check(
        "o bot NAO recebe MESSAGE_CREATE do canal privado",
        !recebidasA.some((d) => d.channelId === privado.id || d.content === marcaPriv),
      );
    }

    // ================================================================
    console.log("\nWebhook de entrada");
    // ================================================================
    const whUser = await criarUsuario(`wh${randomBytes(4).toString("hex")}`, "WEBHOOK");
    const whToken = randomBytes(32).toString("base64url");
    const wh = await prisma.webhook.create({
      data: {
        channelId: geral.id,
        webhookUserId: whUser.id,
        name: `WH ${MARCA}`,
        tokenHash: sha256(whToken),
        creatorId: dono.id,
      },
      select: { id: true },
    });

    check(
      "token errado -> 404",
      (await webhookPost(wh.id, "tokenerrado", { content: "x" })).status === 404,
    );
    check(
      "id errado -> 404",
      (await webhookPost(`wh_${randomBytes(8).toString("hex")}`, whToken, { content: "x" })).status === 404,
    );
    check(
      "conteudo vazio -> 400",
      (await webhookPost(wh.id, whToken, { content: "" })).status === 400,
    );

    const whOk = await webhookPost(wh.id, whToken, { content: `via webhook ${MARCA}` });
    check("token certo -> 201", whOk.status === 201, `status ${whOk.status}`);
    if (whOk.json?.id) {
      const msg = await prisma.message.findUnique({
        where: { id: whOk.json.id },
        select: { channelId: true, authorId: true },
      });
      check("  mensagem no canal do webhook, autor = a identidade do webhook", msg?.channelId === geral.id && msg?.authorId === whUser.id);
    }

    // rate limit do webhook: API_LIMITES.webhook = 5 / 10s, fail-closed
    const rajada = [];
    for (let i = 0; i < 8; i += 1) {
      rajada.push((await webhookPost(wh.id, whToken, { content: `flood ${MARCA} ${i}` })).status);
    }
    const bloqueados = rajada.filter((s) => s === 429).length;
    check(
      "rate limit do webhook barra a rajada (>=1 429)",
      bloqueados >= 1,
      `respostas: ${JSON.stringify(rajada)} (sem 429 pode ser Redis desligado nesse ambiente)`,
    );

    await prisma.webhook.update({ where: { id: wh.id }, data: { revokedAt: new Date() } });
    await esperar(300);
    check(
      "webhook revogado -> 404",
      (await webhookPost(wh.id, whToken, { content: "x" })).status === 404,
    );

    // ================================================================
    console.log("\nRevogar o token do bot");
    // ================================================================
    await prisma.botToken.updateMany({
      where: { applicationId: A.appId },
      data: { revokedAt: new Date() },
    });
    check(
      "token revogado -> 401 na REST",
      (await apiGet("/api/v1/users/me", A.token)).status === 401,
    );
    const reconecta = await conectarBot(A.token);
    if (reconecta.socket) lixo.sockets.push(reconecta.socket);
    check("token revogado -> handshake do gateway recusa", !reconecta.ok, reconecta.error ?? "conectou");

    // ================================================================
    console.log("\nDesinstalar");
    // ================================================================
    const { token: tokenNovo, tokenHash, prefixo } = tokenDeBot();
    await prisma.botToken.create({ data: { applicationId: A.appId, tokenHash, prefixo } });

    await prisma.installation.updateMany({
      where: { applicationId: A.appId, serverId: server.id },
      data: { revokedAt: new Date() },
    });
    await prisma.serverMember.deleteMany({ where: { serverId: server.id, userId: A.botId } });

    check(
      "apos desinstalar, GET /servers/:id volta a 404",
      (await apiGet(`/api/v1/servers/${server.id}`, tokenNovo)).status === 404,
    );
  } finally {
    for (const s of lixo.sockets) {
      try {
        s.close();
      } catch {
        /* ignora */
      }
    }
    // servidor primeiro: leva canais, cargos, membros, overwrites, installations,
    // webhooks e mensagens no cascade. Depois as aplicacoes (levam BotToken).
    for (const id of lixo.servers) {
      await prisma.server.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of lixo.apps) {
      await prisma.application.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of lixo.users) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    console.log("\nfixture descartavel removida");
  }

  console.log(`\n${passed} passaram, ${failed} falharam\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (erro) => {
  console.error("\nerro:", erro);
  for (const s of lixo.sockets) {
    try {
      s.close();
    } catch {
      /* ignora */
    }
  }
  for (const id of lixo.servers) await prisma.server.delete({ where: { id } }).catch(() => undefined);
  for (const id of lixo.apps) await prisma.application.delete({ where: { id } }).catch(() => undefined);
  for (const id of lixo.users) await prisma.user.delete({ where: { id } }).catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
