/**
 * Verificacao do AETHER Activity — a parte de JOGO.
 *
 * O que este script cobre e justamente o que os testes unitarios NAO cobrem:
 * a viagem do nome do jogo por um socket de verdade ate a tela de outra
 * pessoa. A deteccao em si (ler processos, casar com a Steam) e testada em
 * `tests/unit/game-detect.test.ts`, sem tocar no sistema.
 *
 * Uso (com o gateway rodando via "npm run dev:realtime"):
 *   dotenv -e .env -- node scripts/verify-game-activity.mjs
 */
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { io } from "socket.io-client";
import {
  connectedClients,
  requireSeedFixture,
  warnBusyGateway,
} from "./lib/fixture.mjs";

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

const createdSessions = [];

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
    .sign(secret);
  return `aether_session=${token}`;
}

function connect(cookie) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, {
      path: "/ws",
      transports: ["websocket"],
      extraHeaders: { cookie },
      reconnection: false,
      timeout: 5000,
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (error) => reject(new Error(error.message)));
  });
}

function joinServer(socket, serverId) {
  return new Promise((resolve) => socket.emit("server:join", serverId, resolve));
}

/**
 * Um data URL de PNG aceito pelo `safeGameIcon`. O mesmo usado mais abaixo.
 */
const PNG_1X1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

/**
 * Espera a poeira baixar: resolve quando passar `quietoMs` sem nenhum
 * `presence:update` do usuario.
 *
 * Existe porque um anuncio de jogo gera DOIS eventos — o jogo na hora, e a
 * capa do IGDB quando ela chega. Medir "nao houve reenvio" no meio disso
 * captura a capa e reprova codigo correto. Devolve o ultimo evento visto,
 * para quem quiser olhar o que assentou.
 */
function esperarSilencio(socket, userId, quietoMs = 600, tetoMs = 5000) {
  return new Promise((resolve) => {
    let ultimo = null;
    let quantos = 0;
    let timer = setTimeout(terminar, quietoMs);
    const limite = setTimeout(terminar, tetoMs);

    function terminar() {
      clearTimeout(timer);
      clearTimeout(limite);
      socket.off("presence:update", ouvinte);
      resolve({ ultimo, quantos });
    }
    function ouvinte(payload) {
      if (payload?.entry?.userId !== userId) return;
      ultimo = payload.entry;
      quantos += 1;
      clearTimeout(timer);
      timer = setTimeout(terminar, quietoMs);
    }
    socket.on("presence:update", ouvinte);
  });
}

/**
 * Pausa entre um anuncio de jogo e o proximo.
 *
 * O gateway limita presenca a RAJADA DE 10 e recarga de 1/s por usuario, e
 * este script dispara 12 `presence:game`. Sem cadencia ele estoura o balde no
 * meio do caminho, e a partir dali os eventos somem em silencio — o efeito
 * eram falhas que MUDAVAM DE LUGAR a cada rodada, sempre com `undefined`,
 * porque o `waitPresence` seguinte simplesmente estourava o tempo. Rodadas
 * seguidas herdavam o balde vazio da anterior: a 1a passava e as outras nao.
 *
 * Quem esta irreal aqui e o script, nao o limitador: o app de desktop anuncia
 * no maximo uma vez a cada 15 segundos. Andar no ritmo da recarga faz o
 * consumo empatar com ela, entao rodar de novo em seguida tambem fica estavel.
 */
let ultimoAnuncio = 0;
async function respirar() {
  const desde = Date.now() - ultimoAnuncio;
  const falta = 1100 - desde;
  if (falta > 0) await new Promise((r) => setTimeout(r, falta));
  ultimoAnuncio = Date.now();
}

/** Espera UM presence:update do usuario pedido, ou desiste. */
function waitPresence(socket, userId, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off("presence:update", ouvinte);
      resolve(null);
    }, timeoutMs);
    function ouvinte(payload) {
      if (payload?.entry?.userId !== userId) return;
      clearTimeout(timer);
      socket.off("presence:update", ouvinte);
      resolve(payload.entry);
    }
    socket.on("presence:update", ouvinte);
  });
}

async function main() {
  const { owner, member, server } = await requireSeedFixture(prisma);

  // So para avisar em voz alta se houver aba aberta; nenhuma assercao aqui
  // depende do gateway estar vazio, pelo motivo explicado abaixo.
  warnBusyGateway(await connectedClients(BASE));

  /**
   * Quem REPORTA o jogo e o `joao`, nao o `ryan`.
   *
   * Nao e detalhe: o `ryan` costuma estar logado no app de desktop durante o
   * desenvolvimento. Usa-lo aqui teria dois efeitos ruins — o estado de jogo
   * dele sobreviveria entre execucoes (porque o socket do app mantem a
   * presenca viva) e o teste ficaria ESCREVENDO na presenca real de alguem.
   *
   * Com o `joao`, que so existe neste teste, a presenca nasce e morre junto
   * com o script.
   */
  const observador = await connect(await sessionCookie(owner.id));
  const relator = await connect(await sessionCookie(member.id));
  await joinServer(observador, server.id);
  await joinServer(relator, server.id);

  /**
   * Deixa os anuncios de ENTRADA assentarem antes de medir qualquer coisa.
   *
   * Entrar num servidor tambem emite `presence:update` — com `game: null`,
   * porque a pessoa acabou de chegar. Sem esta pausa, o primeiro
   * `waitPresence` capturava esse anuncio em vez do evento de jogo, e o teste
   * reprovava o codigo por um evento que estava correto.
   */
  await new Promise((r) => setTimeout(r, 500));

  console.log("\nJogo propaga para os outros");

  // O `joao` diz que esta jogando; o `ryan` e quem tem de enxergar.
  await respirar();
  let vista = waitPresence(observador, member.id);
  relator.emit("presence:game", { name: "Hollow Knight" });
  let entrada = await vista;

  check("o outro usuario recebe o jogo", entrada?.game === "Hollow Knight",
    `recebeu ${JSON.stringify(entrada?.game)}`);
  check("vem com o carimbo de quando comecou", typeof entrada?.gameSince === "string",
    `gameSince=${JSON.stringify(entrada?.gameSince)}`);
  check("o carimbo e uma data valida",
    entrada?.gameSince && !Number.isNaN(new Date(entrada.gameSince).getTime()));

  /**
   * ESPERA A CAPA ASSENTAR antes de medir a repeticao.
   *
   * Sem isto o teste reprovava codigo correto, e demorou a ser entendido: o
   * anuncio do jogo dispara a busca de metadados em segundo plano, e a capa
   * chega num SEGUNDO `presence:update` uns 60ms depois. O ouvinte montado
   * para flagrar um reenvio duplicado capturava essa capa e dava falha.
   *
   * A capa nao e trafego repetido — e informacao nova, e o motivo pelo qual
   * ela vem separada esta no README. Medido: 1o evento em t=1ms sem capa, 2o
   * em t=61ms com capa; a repeticao em si gerou zero eventos.
   */
  const capa = await esperarSilencio(observador, member.id);
  console.log(
    capa.ultimo?.gameCover
      ? "  ..    a capa do IGDB chegou depois, num evento proprio"
      : "  ..    nenhuma capa veio (IGDB sem o jogo, fora do ar ou sem credencial)",
  );

  // Repetir o MESMO jogo nao pode gerar evento — seria trafego a cada 15s.
  await respirar();
  const repetido = waitPresence(observador, member.id, 1200);
  relator.emit("presence:game", { name: "Hollow Knight" });
  check("repetir o mesmo jogo NAO reemite", (await repetido) === null);

  /**
   * Mas trocar SO O ICONE tem de propagar.
   *
   * O vigia do desktop reanuncia de proposito quando o icone melhora: jogo
   * com anti-cheat sobe em etapas, e existe uma janela em que o unico
   * processo da pasta e o do anti-cheat — no Fall Guys, o icone daquele
   * instante era o escudo do EAC. O gateway comparava so o nome e jogava a
   * melhora fora, desfazendo na ponta um conserto feito do outro lado.
   */
  await respirar();
  const comIcone = waitPresence(observador, member.id, 1500);
  relator.emit("presence:game", { name: "Hollow Knight", icon: PNG_1X1 });
  const melhorado = await comIcone;
  check(
    "o mesmo jogo com icone MELHOR propaga",
    melhorado?.gameIcon === PNG_1X1,
    `gameIcon=${String(JSON.stringify(melhorado?.gameIcon)).slice(0, 40)}`,
  );
  check(
    "e trocar so o icone NAO reinicia o carimbo",
    melhorado?.gameSince === entrada?.gameSince,
    `antes=${entrada?.gameSince} depois=${melhorado?.gameSince}`,
  );

  // Trocar de jogo reinicia o carimbo.
  const antes = entrada.gameSince;
  await new Promise((r) => setTimeout(r, 1100));
  await respirar();
  vista = waitPresence(observador, member.id);
  relator.emit("presence:game", { name: "Portal 2" });
  entrada = await vista;
  check("trocar de jogo propaga", entrada?.game === "Portal 2");
  check("trocar de jogo REINICIA o carimbo", entrada?.gameSince !== antes,
    `antes=${antes} depois=${entrada?.gameSince}`);

  console.log("\nO nome vem do cliente, entao e tratado como texto de cliente");

  await respirar();
  vista = waitPresence(observador, member.id);
  relator.emit("presence:game", { name: "x".repeat(500) });
  entrada = await vista;
  check("nome gigante e cortado, nao aceito inteiro",
    typeof entrada?.game === "string" && entrada.game.length <= 64,
    `veio com ${entrada?.game?.length} caracteres`);

  await respirar();
  vista = waitPresence(observador, member.id);
  relator.emit("presence:game", { name: "   " });
  entrada = await vista;
  check("so espaco em branco vira nulo", entrada?.game === null);

  console.log("\nO icone tambem e dado de cliente");

  const pngValido = PNG_1X1;
  await respirar();
  vista = waitPresence(observador, member.id);
  relator.emit("presence:game", { name: "Com Icone", icon: pngValido });
  entrada = await vista;
  check(
    "icone PNG valido chega ao outro lado",
    entrada?.gameIcon === pngValido,
    `veio ${String(JSON.stringify(entrada?.gameIcon)).slice(0, 50)}`,
  );

  await respirar();
  vista = waitPresence(observador, member.id);
  relator.emit("presence:game", {
    name: "Com SVG",
    icon: "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==",
  });
  entrada = await vista;
  // SVG e documento e aceita script: recusado mesmo sendo image/.
  check(
    "SVG e RECUSADO, e o jogo passa sem icone",
    entrada?.game === "Com SVG" && entrada?.gameIcon === null,
    `game=${entrada?.game} icon=${JSON.stringify(entrada?.gameIcon)}`,
  );

  await respirar();
  vista = waitPresence(observador, member.id);
  relator.emit("presence:game", {
    name: "Icone Gigante",
    icon: "data:image/png;base64," + "A".repeat(40000),
  });
  entrada = await vista;
  check(
    "icone acima do teto e recusado",
    entrada?.gameIcon === null,
    `icon tinha ${entrada?.gameIcon?.length} caracteres`,
  );

  console.log("\nParar de jogar limpa para todos");

  await respirar();
  vista = waitPresence(observador, member.id);
  relator.emit("presence:game", { name: "Hollow Knight" });
  await vista;
  await respirar();
  vista = waitPresence(observador, member.id);
  relator.emit("presence:game", null);
  entrada = await vista;
  check("null apaga o jogo", entrada?.game === null);
  check("e apaga tambem o carimbo", entrada?.gameSince === null);

  console.log("\nDesconectar nao deixa o jogo preso na tela dos outros");

  await respirar();
  vista = waitPresence(observador, member.id);
  relator.emit("presence:game", { name: "Hollow Knight" });
  await vista;

  await respirar();
  vista = waitPresence(observador, member.id, 4000);
  relator.close();
  entrada = await vista;

  /**
   * Estas duas NAO precisam do gateway vazio, diferente do resto do projeto:
   * quem cai aqui e o `joao`, que so existe dentro deste script. O socket do
   * teste e sempre o ultimo dele, entao o anuncio de OFFLINE e deterministico.
   */
  check("ao cair, o outro recebe OFFLINE", entrada?.status === "OFFLINE",
    `status=${entrada?.status}`);
  check("e o jogo NAO vem junto do offline", entrada?.game === null,
    `game=${JSON.stringify(entrada?.game)}`);

  observador.close();
  console.log(`\n${passed} passaram, ${failed} falharam`);
}

main()
  .catch((error) => {
    console.error("\nerro:", error.message);
    failed += 1;
  })
  .finally(async () => {
    if (createdSessions.length > 0) {
      await prisma.session
        .deleteMany({ where: { id: { in: createdSessions } } })
        .catch(() => undefined);
    }
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
