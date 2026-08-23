/**
 * O caminho INTEIRO da capa, com o gateway no ar.
 *
 * O `verify-igdb.mjs` prova os modulos isolados: o token sai, a busca casa, a
 * URL responde. Isso nao prova que o gateway LIGA as pecas — e essa e
 * exatamente a classe de defeito que ja apareceu duas vezes neste projeto (o
 * vigia de jogo emitindo para ninguem, o ouvinte que nunca se inscrevia).
 *
 * Aqui o teste percorre o que a pessoa percorre:
 *
 *   presence:game  ->  anuncio IMEDIATO (nome, sem capa)
 *                  ->  resolucao em segundo plano
 *                  ->  SEGUNDO anuncio, agora com a capa
 *
 * Os dois anuncios importam. Se a capa viesse so no primeiro, a atividade
 * ficaria esperando o IGDB para aparecer — e sumiria quando ele falhasse.
 *
 * Uso (com "npm run dev:realtime" rodando):
 *   dotenv -e .env -- node scripts/verify-igdb-live.mjs
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

const MARCA = `ig${Date.now() % 1_000_000_000}`;
const criados = [];
const sockets = [];
/** Jogo com capa certa no IGDB, e que ninguem por perto esta jogando. */
const JOGO = "Hollow Knight";

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
    socket.once("connect", () => resolve({ ok: true, socket }));
    socket.once("connect_error", (erro) =>
      resolve({ ok: false, error: erro.message }),
    );
  });
}

/** Junta os `friend:presence` que chegarem, na ordem. */
function coletar(socket, evento) {
  const recebidos = [];
  socket.on(evento, (payload) => recebidos.push(payload));
  return recebidos;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const jogador = await criarUsuario("joga");
  const amigo = await criarUsuario("amigo");

  const rA = await conectar(await cookieDe(jogador.id));
  const rB = await conectar(await cookieDe(amigo.id));
  if (!rA.ok || !rB.ok) {
    console.log(`\ngateway fora do ar em ${BASE} — nada a verificar.`);
    console.log("suba com: npm run dev:realtime");
    return;
  }

  // Amigos, para o observador receber a presenca sem servidor em comum.
  await prisma.friendship.create({
    data: { requesterId: jogador.id, addresseeId: amigo.id, status: "ACCEPTED" },
  });
  await fetch(`${BASE}/internal/friends-changed`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-aether-internal": process.env.AUTH_SECRET,
    },
    body: JSON.stringify({ userIds: [jogador.id, amigo.id] }),
  });
  await esperar(400);

  /**
   * O cache e compartilhado, entao pode ja existir uma linha para este jogo de
   * uma execucao anterior. Apagamos para exercitar o caminho COMPLETO —
   * incluindo a ida ao IGDB — e nao so a leitura do cache.
   */
  const { normalizarNome } = await import(
    "../apps/realtime/src/games/normalize.ts"
  );
  const chave = normalizarNome(JOGO);
  await prisma.gameMetadata
    .delete({ where: { lookupKey: chave } })
    .catch(() => undefined);

  console.log(`\nCache limpo para "${JOGO}" — o caminho vai ate o IGDB\n`);
  console.log("Os DOIS anuncios: o imediato e o enriquecido");

  const recebidos = coletar(rB.socket, "friend:presence");
  rA.socket.emit("presence:game", { name: JOGO, icon: null });

  // O primeiro anuncio e sincrono; o segundo espera o IGDB.
  await esperar(600);
  const doPrimeiro = recebidos.length;
  const primeiro = recebidos.find((p) => p.entry?.game);
  check(
    "o anuncio IMEDIATO chega com o nome do jogo",
    primeiro?.entry?.game === JOGO,
    JSON.stringify(primeiro?.entry),
  );
  check(
    "e ele NAO espera a capa — aparece antes dela",
    primeiro?.entry?.gameCover === null,
    `veio ${JSON.stringify(primeiro?.entry?.gameCover)}`,
  );

  // Agora sim, o enriquecimento.
  await esperar(6000);
  const comCapa = recebidos.find((p) => p.entry?.gameCover);
  check(
    "o SEGUNDO anuncio chega, agora com a capa",
    Boolean(comCapa),
    `chegaram ${recebidos.length} eventos (${doPrimeiro} antes de esperar)`,
  );
  if (comCapa) {
    console.log(`        capa: ${comCapa.entry.gameCover}`);
    check(
      "a capa e do CDN do IGDB",
      comCapa.entry.gameCover.startsWith(
        "https://images.igdb.com/igdb/image/upload/",
      ),
    );
    check(
      "e o nome continua o mesmo",
      comCapa.entry.game === JOGO,
      comCapa.entry.game,
    );
  }

  console.log("\nO gateway gravou o cache compartilhado");

  const linha = await prisma.gameMetadata.findUnique({
    where: { lookupKey: chave },
  });
  check("gravou a linha", linha !== null);
  check("com a capa", Boolean(linha?.coverUrl), linha?.coverUrl ?? "sem capa");
  check("marcada como vinda do IGDB", linha?.source === "IGDB", linha?.source);
  check("com o id do IGDB", typeof linha?.igdbId === "number", String(linha?.igdbId));
  check(
    "e com confianca registrada",
    typeof linha?.confidence === "number",
    String(linha?.confidence),
  );

  console.log("\nTrocar de jogo nao carrega a capa do anterior");

  const antes = recebidos.length;
  rA.socket.emit("presence:game", { name: "Rocket League", icon: null });
  await esperar(600);
  const novos = recebidos.slice(antes);
  const trocou = novos.find((p) => p.entry?.game === "Rocket League");
  check("o jogo novo chega", Boolean(trocou), JSON.stringify(novos.map((n) => n.entry?.game)));
  /**
   * A corrida que este teste existe para pegar: a capa e resolvida em segundo
   * plano e chega depois. Se ela nao fosse zerada na troca, o jogo novo
   * apareceria por um instante com a arte do que acabou de ser fechado.
   */
  check(
    "e SEM a capa do jogo anterior grudada",
    trocou?.entry?.gameCover === null,
    `veio ${JSON.stringify(trocou?.entry?.gameCover)}`,
  );

  console.log("\nFechar o jogo limpa tudo");

  const antesDeLimpar = recebidos.length;
  rA.socket.emit("presence:game", null);
  await esperar(600);
  const limpou = recebidos.slice(antesDeLimpar).at(-1);
  check("o jogo some", limpou?.entry?.game === null, JSON.stringify(limpou?.entry));
  check("e a capa junto", limpou?.entry?.gameCover === null);

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
