import { createServer } from "node:http";
import { Server } from "socket.io";
import { prisma } from "@aether/db";
import { loadFriendIds } from "@aether/access";
import { room } from "@aether/shared";
import { env } from "./env";
import { authenticateHandshake } from "./auth";
import { registerPresenceHandlers } from "./handlers/presence";
import { registerMessageHandlers } from "./handlers/messages";
import { registerVoiceHandlers } from "./handlers/voice";
import { registerDmHandlers } from "./handlers/dm";
import { joinAllServerRooms } from "./rooms";
import {
  attachSocket,
  isConnected,
  presenceOfFriends,
  setFriends,
  stats,
  statusOf,
} from "./state";
import { handleInternalRequest } from "./internal";
import { startSessionGuard } from "./session-guard";
import type { AetherServer } from "./types";

/**
 * Gateway WebSocket do Aether.
 *
 * Sobe o servidor, autentica o handshake com a sessao do app web e delega os
 * eventos para os handlers. Este arquivo nao tem regra de negocio de proposito:
 * quem decide qualquer coisa e o handler, e quem decide permissao e
 * @aether/access.
 */

const httpServer = createServer((request, response) => {
  /**
   * Porta de servico do app web (expulsar/banir precisam tirar o socket das
   * salas na hora). Fica antes do /health porque tem autenticacao propria.
   */
  if (request.url?.startsWith("/internal/")) {
    void handleInternalRequest(io, request, response).catch((error) => {
      console.error("[gateway] rota interna falhou:", error);
      response.writeHead(500);
      response.end();
    });
    return;
  }

  // Endpoint de saude — usado por deploy/monitor para saber se o processo vive.
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ ok: true, uptime: process.uptime(), ...stats() }),
    );
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
});

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
    console.error("[gateway] falha ao autenticar handshake:", error);
    next(new Error("unauthorized"));
  }
});

io.on("connection", (socket) => {
  const { user } = socket.data;
  /**
   * Lido ANTES de anexar: depois de `attachSocket` a resposta e sempre `true`.
   * O que interessa e se esta era a PRIMEIRA aba — abrir a segunda nao e
   * "ficou online" e nao deve avisar ninguem de novo.
   */
  const primeiraConexao = !isConnected(user.id);
  attachSocket(socket.id, user.id, user.status);

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
    console.error("[gateway] nao consegui entrar nas salas dos servidores:", erro);
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
    .then((amigos) => {
      setFriends(user.id, amigos);

      // Quem ja esta online, para a lista nascer preenchida.
      socket.emit("friend:sync", { entries: presenceOfFriends(user.id) });

      if (!primeiraConexao) return;
      /**
       * "Entrei." Vai so para os amigos que estao conectados — quem estiver
       * fora recebe o estado inteiro no proprio `friend:sync` ao voltar.
       *
       * O status e o do ESTADO, nao o do banco: `attachSocket` promove
       * OFFLINE ("nunca escolheu") para ONLINE, e mandar o valor cru faria a
       * pessoa aparecer offline para os amigos assim que conectasse.
       */
      const meuStatus = statusOf(user.id);
      if (amigos.length > 0) {
        io.to(amigos.map(room.user)).emit("friend:presence", {
          entry: {
            userId: user.id,
            status: meuStatus,
            // Acabou de conectar: ainda nao ha jogo detectado. O app de
            // desktop manda `presence:game` logo em seguida, se houver.
            game: null,
            gameSince: null,
            gameIcon: null,
            gameCover: null,
          },
        });
      }
    })
    .catch((error) =>
      console.error("[gateway] nao consegui carregar amizades:", error),
    );

  socket.on("ping", (ack) => {
    if (typeof ack === "function") ack(Date.now());
  });

  registerPresenceHandlers(io, socket);
  registerMessageHandlers(io, socket);
  registerVoiceHandlers(io, socket);
  registerDmHandlers(socket);

  socket.on("disconnect", (reason) => {
    if (!env.isProduction) {
      console.log(`[gateway] saiu ${user.username} (${reason})`);
    }
  });

  if (!env.isProduction) {
    console.log(`[gateway] entrou ${user.username} (${socket.id})`);
  }
});

const stopSessionGuard = startSessionGuard(io);

httpServer.listen(env.port, () => {
  console.log(`[gateway] ouvindo em http://localhost:${env.port}/ws`);
  console.log(`[gateway] origem liberada para cookie: ${env.corsOrigin}`);
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
  console.log(`[gateway] ${signal} recebido, encerrando...`);

  stopSessionGuard();

  // Sem isso, uma conexao keep-alive ociosa segura a porta ate o timeout dela.
  httpServer.closeAllConnections();
  httpServer.close();

  await io.close().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
