import { createServer } from "node:http";
import { Server } from "socket.io";
import { prisma } from "@aether/db";
import { env } from "./env";
import { authenticateHandshake } from "./auth";
import { registerPresenceHandlers } from "./handlers/presence";
import { registerMessageHandlers } from "./handlers/messages";
import { registerVoiceHandlers } from "./handlers/voice";
import { attachSocket, stats } from "./state";
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
  attachSocket(socket.id, user.id, user.status);

  socket.emit("ready", { user, serverTime: Date.now() });

  socket.on("ping", (ack) => {
    if (typeof ack === "function") ack(Date.now());
  });

  registerPresenceHandlers(io, socket);
  registerMessageHandlers(io, socket);
  registerVoiceHandlers(io, socket);

  socket.on("disconnect", (reason) => {
    if (!env.isProduction) {
      console.log(`[gateway] saiu ${user.username} (${reason})`);
    }
  });

  if (!env.isProduction) {
    console.log(`[gateway] entrou ${user.username} (${socket.id})`);
  }
});

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

  // Sem isso, uma conexao keep-alive ociosa segura a porta ate o timeout dela.
  httpServer.closeAllConnections();
  httpServer.close();

  await io.close().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
