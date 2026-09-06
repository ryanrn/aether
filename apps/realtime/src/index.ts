import { createServer } from "node:http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { prisma } from "@aether/db";
import { loadFriendIds } from "@aether/access";
import { room } from "@aether/shared";
import { capturarFalhasDoProcesso, configurarLog, log } from "@aether/shared/log";
import { criarSinkSentry } from "@aether/shared/sentry";
import { env } from "./env";
import { authenticateHandshake } from "./auth";
import { registerPresenceHandlers } from "./handlers/presence";
import { registerMessageHandlers } from "./handlers/messages";
import { registerVoiceHandlers } from "./handlers/voice";
import { registerDmHandlers } from "./handlers/dm";
import { registerReactionHandlers } from "./handlers/reactions";
import { joinAllServerRooms } from "./rooms";
import { limparCargosDeJogoNaConexao } from "./games/cargos-por-jogo";
import { varrerSalasEfemeras } from "./voz/salas-efemeras";
import {
  attachSocket,
  isConnected,
  presenceOfFriends,
  setFriends,
  socketIdsOf,
  stats,
  statusOf,
} from "./state";
import { socketsAcimaDoTeto } from "./socket-cap";
import { redisClients } from "./redis-client";
import { handleInternalRequest } from "./internal";
import { startSessionGuard } from "./session-guard";
import { iniciarSpotifyPoller } from "./spotify/poller";
import type { AetherServer, AetherSocket } from "./types";

/**
 * Gateway WebSocket do Aether.
 *
 * Sobe o servidor, autentica o handshake com a sessao do app web e delega os
 * eventos para os handlers. Este arquivo nao tem regra de negocio de proposito:
 * quem decide qualquer coisa e o handler, e quem decide permissao e
 * @aether/access.
 */

/**
 * Sink do Sentry ANTES da captura de falhas: assim uma excecao no boot ja
 * chega la. `null` sem `SENTRY_DSN` — em dev e no primeiro deploy nada
 * acontece, so o stdout.
 */
const sinkSentry = criarSinkSentry({ servico: "gateway" });
if (sinkSentry) configurarLog({ sink: sinkSentry });

/**
 * Uma Promise rejeitada sem `catch` ou uma excecao que escapou de todo `try`
 * sumiam aqui sem deixar linha nenhuma — o processo morria e so o `fly logs`
 * de "exited" contava a historia. Agora viram um `error` estruturado (e vao ao
 * Sentry pelo sink acima); `uncaughtException` ainda encerra (estado
 * indefinido), e o Fly reinicia a maquina limpa.
 */
capturarFalhasDoProcesso();

log.info("gateway.observabilidade", "log estruturado ativo", {
  sentry: Boolean(sinkSentry),
  nivelMinimo: process.env.LOG_LEVEL ?? "(padrão)",
});

const httpServer = createServer((request, response) => {
  /**
   * Porta de servico do app web (expulsar/banir precisam tirar o socket das
   * salas na hora). Fica antes do /health porque tem autenticacao propria.
   */
  if (request.url?.startsWith("/internal/")) {
    void handleInternalRequest(io, request, response).catch((error) => {
      log.error("gateway.rota_interna.falhou", "rota interna falhou", {
        err: error,
        rota: request.url,
      });
      response.writeHead(500);
      response.end();
    });
    return;
  }

  // Endpoint de saude — usado por deploy/monitor para saber se o processo vive.
  if (request.url === "/health") {
    void stats()
      .then((numeros) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ ok: true, uptime: process.uptime(), ...numeros }),
        );
      })
      .catch((erro) => {
        log.error("gateway.health.falhou", "/health falhou", { err: erro });
        response.writeHead(500);
        response.end();
      });
    return;
  }
  response.writeHead(404);
  response.end();
});

const io: AetherServer = new Server(httpServer, {
  path: "/ws",
  // `credentials` e o que faz o navegador anexar o cookie httpOnly de sessao.
  cors: { origin: env.corsOrigin, credentials: true },
  transports: ["websocket", "polling"],
  /**
   * Heartbeat explicito. O Engine.IO ja faz isso sozinho, mas com valores
   * padrao — e padrao implicito e o tipo de coisa que muda numa atualizacao de
   * dependencia sem ninguem perceber. Aqui esta declarado e mais agressivo que
   * o default (25s/20s): queda de conexao vira presenca errada na tela alheia,
   * entao detectar rapido importa.
   */
  pingInterval: 10_000,
  pingTimeout: 8_000,
  /**
   * Teto de bytes por mensagem. O default do Engine.IO e 1 MB; nada que os
   * handlers aceitam chega perto — a maior carga legitima e uma mensagem de
   * chat, e o texto ja e cortado bem abaixo disso. 256 KB deixa folga para
   * qualquer payload real e corta o cliente que tenta empurrar um blob pelo
   * canal de eventos.
   */
  maxHttpBufferSize: 256 * 1024,
});

/**
 * Adapter de Redis (fase 7c-2) — SO troca como `io.to(sala).emit(...)`
 * alcanca sockets de OUTRAS instancias; nao guarda presenca nem voz (isso e
 * `state.ts`). Sem `REDIS_URL`, `io` continua com o adapter em memoria
 * padrao do Socket.IO — uma instancia so, exatamente como sempre foi.
 */
if (redisClients) {
  io.adapter(createAdapter(redisClients.pub, redisClients.sub));
}

/**
 * Porta de entrada unica: ninguem passa daqui sem sessao valida.
 * Recusar no middleware (e nao dentro de cada evento) garante que nenhum
 * handler precise perguntar "esse socket esta autenticado?".
 */
io.use(async (socket, next) => {
  try {
    const data = await authenticateHandshake({
      cookieHeader: socket.handshake.headers.cookie,
      ticket: socket.handshake.auth?.ticket,
    });
    if (!data) {
      next(new Error("unauthorized"));
      return;
    }
    socket.data = data;
    next();
  } catch (error) {
    log.error("gateway.handshake.erro", "falha ao autenticar handshake", {
      err: error,
      socketId: socket.id,
    });
    next(new Error("unauthorized"));
  }
});

/**
 * Poller do Spotify. Fica fora do `io.on("connection")` porque e um so para o
 * processo inteiro — os handlers de cada socket so o avisam de quem observar.
 * Sem `SPOTIFY_CLIENT_ID/SECRET`, `observar` e no-op e nada disto roda.
 */
const spotifyPoller = iniciarSpotifyPoller(io);

io.on("connection", (socket) => {
  const { user } = socket.data;

  /**
   * Registrado ANTES de qualquer `await`, de proposito: com o estado
   * assincrono (fase 7c-2, `state.ts`), ha uma janela real entre a conexao
   * chegar e `iniciarConexao` terminar de anexar o socket. Se o "disconnect"
   * chegasse nessa janela e os handlers so fossem registrados DEPOIS dela, a
   * limpeza simplesmente nao rodaria — o socket ficaria "preso" no estado
   * para sempre. `detachSocket`/`leaveVoice` sao seguros de chamar mesmo
   * quando `attachSocket` nunca chegou a terminar: devolvem "nada a fazer".
   */
  registerPresenceHandlers(io, socket, spotifyPoller);
  registerMessageHandlers(io, socket);
  registerVoiceHandlers(io, socket);
  registerDmHandlers(socket);
  registerReactionHandlers(io, socket);

  socket.on("ping", (ack) => {
    if (typeof ack === "function") ack(Date.now());
  });

  socket.on("disconnect", (reason) => {
    if (!env.isProduction) {
      console.log(`[gateway] saiu ${user.username} (${reason})`);
    }
  });

  if (!env.isProduction) {
    console.log(`[gateway] entrou ${user.username} (${socket.id})`);
  }

  void iniciarConexao(socket).catch((erro) => {
    log.error("gateway.conexao.falhou", "falha ao iniciar conexão", {
      err: erro,
      socketId: socket.id,
      userId: user.id,
    });
  });
});

/**
 * A parte da conexao que depende do estado (presenca, amizades) — separada
 * do bloco acima exatamente pela razao explicada ali: isto tem `await`, e os
 * handlers de evento (inclusive o de desconexao) precisam existir antes de
 * qualquer um deles rodar.
 */
async function iniciarConexao(socket: AetherSocket): Promise<void> {
  const { user } = socket.data;

  /**
   * Lido ANTES de anexar: depois de `attachSocket` a resposta e sempre `true`.
   * O que interessa e se esta era a PRIMEIRA aba — abrir a segunda nao e
   * "ficou online" e nao deve avisar ninguem de novo.
   */
  const primeiraConexao = !(await isConnected(user.id));
  await attachSocket(socket.id, user.id, user.status);

  /**
   * Teto de conexoes por usuario. Lido DEPOIS de anexar — a lista ja inclui o
   * socket novo — e derruba os excedentes mais antigos, nunca o recem-chegado
   * (ver `socket-cap.ts`). `io.in(id).disconnectSockets` usa o adapter, entao
   * alcanca o socket mesmo numa outra instancia do gateway.
   */
  const meusSockets = await socketIdsOf(user.id);
  const aExpulsar = socketsAcimaDoTeto(
    meusSockets,
    socket.id,
    env.maxSocketsPorUsuario,
  );
  if (aExpulsar.length > 0) {
    log.warn("gateway.socket.teto", "usuário acima do teto de conexões", {
      userId: user.id,
      socketId: socket.id,
      ativos: meusSockets.length,
      teto: env.maxSocketsPorUsuario,
      expulsando: aExpulsar.length,
    });
    for (const id of aExpulsar) io.in(id).disconnectSockets(true);
  }

  socket.emit("ready", { user, serverTime: Date.now() });

  /**
   * Sala pessoal. Todo socket entra na sua, sempre — e por ela que chega o que
   * e endereçado a PESSOA e nao a um servidor: presenca de amigo e aviso de
   * que a lista de amizades mudou.
   *
   * Nao ha checagem de permissao aqui de proposito: a sala e a do proprio
   * usuario autenticado no handshake. Ninguem entra na sala de outro porque o
   * nome vem de `socket.data`, que o cliente nao escolhe.
   */
  void socket.join(room.user(user.id));

  /**
   * Salas de TODOS os servidores da pessoa, e nao so o aberto.
   *
   * E o que permite o contador de nao lidas acender no icone de um servidor em
   * que voce nao esta olhando agora — sem isso, a mensagem de la nunca chegava
   * ao cliente. Sem `await` pelo mesmo motivo das amizades: o resto do
   * handshake nao depende, e segurar a conexao por N consultas atrasaria o
   * `ready` de todo mundo.
   */
  void joinAllServerRooms(socket).catch((erro) => {
    log.error("gateway.salas.falhou", "não entrei nas salas dos servidores", {
      err: erro,
      socketId: socket.id,
      userId: user.id,
    });
  });

  /**
   * Cargo por jogo: apaga o que sobrou de um restart do gateway (o estado de
   * "jogando" e so memoria; o `MemberRole` nao). Sem `await` — o handshake nao
   * depende, e a limpeza toca apenas servidores que usam o recurso.
   */
  void limparCargosDeJogoNaConexao(io, user.id).catch((erro) => {
    log.warn("gateway.cargo_por_jogo.conexao", "limpeza na conexão falhou", {
      err: erro,
      userId: user.id,
    });
  });

  /**
   * Amizades: carregadas do banco uma vez por conexao.
   *
   * Assincrono e sem `await` porque o resto do handshake nao depende disto —
   * segurar a conexao por uma consulta atrasaria o `ready` de todo mundo. A
   * consequencia e uma janela de alguns milissegundos em que a presenca de um
   * amigo que mudou nesse instante nao seria roteada; o `friend:sync` logo
   * abaixo fecha essa janela do lado de quem conectou.
   */
  void loadFriendIds(user.id)
    .then(async (amigos) => {
      await setFriends(user.id, amigos);

      // Quem ja esta online, para a lista nascer preenchida.
      socket.emit("friend:sync", { entries: await presenceOfFriends(user.id) });

      if (!primeiraConexao) return;
      /**
       * "Entrei." Vai so para os amigos que estao conectados — quem estiver
       * fora recebe o estado inteiro no proprio `friend:sync` ao voltar.
       *
       * O status e o do ESTADO, nao o do banco: `attachSocket` promove
       * OFFLINE ("nunca escolheu") para ONLINE, e mandar o valor cru faria a
       * pessoa aparecer offline para os amigos assim que conectasse.
       */
      const meuStatus = await statusOf(user.id);
      if (amigos.length > 0) {
        io.to(amigos.map(room.user)).emit("friend:presence", {
          entry: {
            userId: user.id,
            status: meuStatus,
            // Acabou de conectar: ainda nao ha jogo detectado. O app de
            // desktop manda `presence:game` logo em seguida, se houver, e o
            // poller do Spotify anuncia a musica na primeira consulta.
            game: null,
            gameSince: null,
            gameIcon: null,
            gameCover: null,
            listening: null,
          },
        });
      }
    })
    .catch((error) =>
      log.error("gateway.amizades.falhou", "não carreguei amizades", {
        err: error,
        userId: user.id,
      }),
    );
}

const stopSessionGuard = startSessionGuard(io);

/**
 * Varredura das salas de voz efemeras. O caminho por evento
 * (`talvezRemoverSalaEfemera`) cobre "a ultima pessoa saiu"; esta varredura
 * pega o resto — sala criada e ninguem entrou, ou o gateway reiniciou com
 * salas cheias que depois esvaziaram sem gerar `leaveVoice`.
 */
const salasEfemerasTimer = setInterval(() => {
  void varrerSalasEfemeras(io);
}, 3 * 60 * 1000);
salasEfemerasTimer.unref?.();

httpServer.listen(env.port, () => {
  log.info("gateway.boot", `gateway ouvindo na porta ${env.port}`, {
    porta: env.port,
    origens: env.corsOrigin,
    comRedis: Boolean(redisClients),
    comSfu: Boolean(env.livekit),
  });
});

/**
 * Encerramento limpo: em dev o tsx reinicia a cada save e um processo que nao
 * solta a porta e o pool do Postgres vira erro de "porta em uso" na segunda
 * gravacao.
 */
let shuttingDown = false;

async function shutdown(signal: string) {
  // O tsx watch manda o sinal a cada gravacao; entrar duas vezes aqui deixava
  // o processo velho segurando a porta e o novo morria com EADDRINUSE.
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("gateway.encerrando", `${signal} recebido, encerrando`, { signal });

  stopSessionGuard();
  clearInterval(salasEfemerasTimer);
  spotifyPoller.parar();

  // Sem isso, uma conexao keep-alive ociosa segura a porta ate o timeout dela.
  httpServer.closeAllConnections();
  httpServer.close();

  await io.close().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
