/**
 * Fase 7c-2 (Redis para presenca/voz + adapter do Socket.IO), contra um
 * Redis DE VERDADE e DUAS conexoes independentes — simulando duas maquinas
 * de gateway.
 *
 * POR QUE ISTO EXISTE, e nao so os testes de unidade em memoria: o ponto
 * inteiro desta fase e o comportamento ENTRE processos — e isso e
 * exatamente o que um teste de unidade, rodando num processo so, nao
 * consegue provar. Mesmo raciocinio do `verificar-redis.mts` (rate limit e
 * ticket): a semantica real depende do servidor Redis, nao da leitura do
 * codigo.
 *
 * DUAS PARTES:
 *  A. `state-redis.ts` direto, com duas conexoes `ioredis` separadas —
 *     prova que presenca e voz escritas por uma "instancia" aparecem para a
 *     outra, e que o par de scripts Lua (entrar/sair de servidor) decide
 *     "ficou presente" corretamente quando as DUAS conexoes escrevem ao
 *     mesmo tempo.
 *  B. Dois servidores Socket.IO de verdade, cada um com seu proprio par
 *     pub/sub do `@socket.io/redis-adapter`, e um cliente real conectado a
 *     cada um — prova que `io.to(sala).emit(...)` na instancia A chega no
 *     socket conectado na instancia B. E o mecanismo exato que
 *     `evict()`, `resyncServerRooms()` e `voice:move` passaram a usar no
 *     lugar de `io.sockets.sockets.get()` (que so enxerga sockets locais).
 *
 * NAO RODAR CONTRA O REDIS DE PRODUCAO com dados de verdade sem entender o
 * que faz: cria chaves `gw:` reais (usuarios e servidores descartaveis,
 * removidos no fim) e, por alguns segundos, um par de servidores Socket.IO
 * de teste conversando pelo mesmo canal pub/sub que o gateway real usaria.
 * Local (`redis://127.0.0.1:6379`, o padrao aqui) e o uso pretendido.
 *
 * Uso:
 *   npx tsx scripts/verify-gateway-redis.mts
 *   REDIS_URL="rediss://...upstash.io" npx tsx scripts/verify-gateway-redis.mts
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Redis } from "ioredis";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createRedisStore } from "../apps/realtime/src/state-redis";
import type { PublicUser } from "../packages/shared/src/index";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

let passou = 0;
let falhou = 0;
const ok = (r: string, d = "") => {
  passou += 1;
  console.log(`  ok    ${r}${d ? ` — ${d}` : ""}`);
};
const falha = (r: string, d = "") => {
  falhou += 1;
  console.log(`  FALHA ${r}${d ? ` — ${d}` : ""}`);
};
const diz = (bom: boolean, r: string, d = "") => (bom ? ok(r, d) : falha(r, d));

const MARCA = randomUUID().slice(0, 8);
const fakeUser = (id: string): PublicUser => ({
  id,
  username: `verify-${MARCA}-${id}`,
  displayName: `Cobaia ${id}`,
  avatarUrl: null,
  status: "ONLINE",
  plano: "FREE",
  moldura: null,
});

async function parteA_estadoCompartilhado(): Promise<void> {
  console.log("\nParte A — presenca e voz entre duas conexoes Redis\n");

  const redisA = new Redis(REDIS_URL);
  const redisB = new Redis(REDIS_URL);
  const storeA = createRedisStore(redisA);
  const storeB = createRedisStore(redisB);

  const srv = `srv-${MARCA}`;
  const userX = `userX-${MARCA}`;
  const userY = `userY-${MARCA}`;
  const userZ = `userZ-${MARCA}`;
  const userV = `userV-${MARCA}`;

  try {
    // --- presenca basica, escrita numa "instancia", lida na outra ---
    await storeA.attachSocket("sockA1", userX, "ONLINE");
    const ficouPresenteX = await storeA.joinServer("sockA1", srv);
    diz(ficouPresenteX, "1a pessoa a entrar no servidor conta como 'ficou presente'");

    const presencaVistaPorB = await storeB.presenceOf(srv);
    diz(
      presencaVistaPorB.some((e) => e.userId === userX),
      "instancia B ve quem entrou pela instancia A",
      JSON.stringify(presencaVistaPorB.map((e) => e.userId)),
    );

    await storeB.attachSocket("sockB1", userY, "ONLINE");
    const ficouPresenteY = await storeB.joinServer("sockB1", srv);
    diz(ficouPresenteY, "2a pessoa (por B) tambem conta como 'ficou presente'");

    const presencaVistaPorA = await storeA.presenceOf(srv);
    diz(
      presencaVistaPorA.length === 2,
      "instancia A ve as DUAS pessoas (uma entrou por A, outra por B)",
      `${presencaVistaPorA.length} entradas`,
    );

    const saiuX = await storeA.leaveServer("sockA1", srv);
    diz(saiuX, "sair (pela mesma instancia que entrou) devolve true");
    const presencaDepois = await storeB.presenceOf(srv);
    diz(
      presencaDepois.length === 1 && presencaDepois[0]?.userId === userY,
      "so sobra quem nao saiu, visto pela OUTRA instancia",
    );

    await storeA.detachSocket("sockA1");
    diz(
      !(await storeB.isConnected(userX)),
      "detachSocket (por A) e visto como desconectado por B",
    );

    // --- a corrida de verdade: dois sockets do MESMO usuario, entrando no
    // MESMO servidor, uma por cada instancia, ao mesmo tempo ---
    await storeA.attachSocket("sockA2", userZ, "ONLINE");
    await storeB.attachSocket("sockB2", userZ, "ONLINE");
    const [r1, r2] = await Promise.all([
      storeA.joinServer("sockA2", `${srv}-race`),
      storeB.joinServer("sockB2", `${srv}-race`),
    ]);
    diz(
      r1 !== r2 && (r1 || r2),
      "duas entradas simultaneas do MESMO usuario: so UMA conta como 'ficou presente'",
      `A=${r1} B=${r2}`,
    );
    await storeA.leaveServer("sockA2", `${srv}-race`);
    await storeB.leaveServer("sockB2", `${srv}-race`);
    await storeA.detachSocket("sockA2");
    await storeB.detachSocket("sockB2");

    // --- voz, entre instancias ---
    await storeA.attachSocket("sockA3", userV, "ONLINE");
    await storeA.joinVoice({
      socketId: "sockA3",
      userId: userV,
      user: fakeUser(userV),
      serverId: `${srv}-voz`,
      channelId: `${srv}-canal`,
    });

    const vozVistaPorB = await storeB.voiceOfServer(`${srv}-voz`);
    diz(
      vozVistaPorB.some((p) => p.userId === userV),
      "quem entrou em voz pela instancia A aparece pela B",
    );

    const localizacao = await storeB.voiceLocation(userV);
    diz(
      localizacao?.channelId === `${srv}-canal`,
      "voiceLocation (por B) acerta o canal gravado por A",
    );

    const ocupantesDoCanal = await storeA.countInChannel(`${srv}-canal`);
    diz(ocupantesDoCanal === 1, "countInChannel conta 1 ocupante", `${ocupantesDoCanal}`);

    const saiuDaVoz = await storeB.leaveVoice(userV, "sockA3");
    diz(
      saiuDaVoz?.serverId === `${srv}-voz`,
      "leaveVoice (pela instancia B) funciona sobre um socket que entrou pela A",
    );
    const vozDepois = await storeA.voiceOfServer(`${srv}-voz`);
    diz(vozDepois.length === 0, "servidor de voz esvazia, visto pela instancia A");

    await storeA.detachSocket("sockA3");
  } finally {
    // Faxina: nada disto pode sobreviver ao script, nem contra Redis local.
    // `sockB1` (userY) fica pendurado se algum `diz()` acima lancar antes de
    // chegar la — soltar aqui, incondicionalmente, e o que garante isso.
    await storeB.detachSocket("sockB1").catch(() => undefined);

    // Os conjuntos GLOBAIS (`gw:p:allusers`, `gw:p:allsockets`, ...) nao tem
    // a MARCA no nome da chave — so nos membros — entao o `KEYS gw:*MARCA*`
    // abaixo nunca os alcança. Tira so os membros desta rodada, sem apagar
    // os conjuntos (podem ter entradas de outro uso do mesmo Redis).
    await redisA
      .srem(
        "gw:p:allusers",
        userX,
        userY,
        userZ,
        userV,
      )
      .catch(() => undefined);

    const chaves = await redisA.keys(`gw:*${MARCA}*`);
    if (chaves.length > 0) await redisA.del(...chaves);
    redisA.disconnect();
    redisB.disconnect();
  }
}

async function parteB_adapterEntreInstancias(): Promise<void> {
  console.log("\nParte B — adapter de Redis entre dois servidores Socket.IO\n");

  const pubA = new Redis(REDIS_URL);
  const subA = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  const pubB = new Redis(REDIS_URL);
  const subB = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

  const httpA = createServer();
  const httpB = createServer();
  const ioA = new Server(httpA);
  const ioB = new Server(httpB);
  ioA.adapter(createAdapter(pubA, subA));
  ioB.adapter(createAdapter(pubB, subB));

  const sala = `sala-${MARCA}`;
  ioA.on("connection", (socket) => void socket.join(sala));
  ioB.on("connection", (socket) => void socket.join(sala));

  let clientB: ClientSocket | undefined;

  try {
    await new Promise<void>((resolve) => httpA.listen(0, resolve));
    await new Promise<void>((resolve) => httpB.listen(0, resolve));
    const portaA = (httpA.address() as { port: number }).port;
    const portaB = (httpB.address() as { port: number }).port;

    clientB = ioClient(`http://127.0.0.1:${portaB}`, {
      transports: ["websocket"],
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("cliente nao conectou")), 4000);
      clientB!.on("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      clientB!.on("connect_error", (erro) => {
        clearTimeout(timer);
        reject(erro);
      });
    });

    // Tempo para o `join` do servidor B chegar e o pub/sub do adapter
    // propagar a assinatura da sala entre as duas instancias.
    await new Promise((r) => setTimeout(r, 400));

    const recebido = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout esperando o evento")), 4000);
      clientB!.once("evento-entre-instancias", (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    // O EMIT SAI DA INSTANCIA A; o cliente que vai receber esta conectado
    // na B. So chega se o adapter de Redis estiver de fato ligando as duas.
    ioA.to(sala).emit("evento-entre-instancias", { origem: "A", portaA });

    const payload = await recebido;
    diz(
      Boolean(payload && typeof payload === "object" && (payload as { origem?: string }).origem === "A"),
      "io.to(sala).emit() na instancia A chega no cliente conectado na instancia B",
    );

    // fetchSockets tambem precisa ser cross-instance — e o que evict() e
    // resyncServerRooms() passaram a usar no lugar de sockets.sockets.get().
    const socketsDaSala = await ioA.in(sala).fetchSockets();
    diz(
      socketsDaSala.length === 1,
      "fetchSockets() na instancia A enxerga o socket conectado na B",
      `${socketsDaSala.length} socket(s)`,
    );

    await ioA.in(sala).socketsLeave(sala);
    await new Promise((r) => setTimeout(r, 200));
    const depoisDeSair = await ioB.in(sala).fetchSockets();
    diz(
      depoisDeSair.length === 0,
      "socketsLeave() na instancia A tira o socket que esta na B",
    );
  } finally {
    clientB?.close();
    await ioA.close().catch(() => undefined);
    await ioB.close().catch(() => undefined);
    await Promise.all([pubA.quit(), subA.quit(), pubB.quit(), subB.quit()].map((p) => p.catch(() => undefined)));
  }
}

async function main() {
  console.log(`Redis: ${REDIS_URL.replace(/:[^:@]*@/, ":***@")}`);
  await parteA_estadoCompartilhado();
  await parteB_adapterEntreInstancias();
  console.log(`\n${passou} passaram, ${falhou} falharam`);
  if (falhou > 0) process.exitCode = 1;
}

main().catch((erro) => {
  console.error("\nerro:", erro instanceof Error ? erro.stack ?? erro.message : erro);
  process.exitCode = 1;
});
