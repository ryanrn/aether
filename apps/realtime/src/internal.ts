import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "@aether/db";
import { loadFriendIds } from "@aether/access";
import { room, SELECT_USUARIO_PUBLICO, toPublicUser } from "@aether/shared";
import { log } from "@aether/shared/log";
import { env } from "./env";
import { resyncEavisarServidor } from "./rooms";
import { enviarMensagem } from "./enviar-mensagem";
import { entrarNaVoz, sairDaVoz, sairDaVozDoCanal } from "./entrar-em-voz";
import type { AetherServer } from "./types";
import {
  countInChannel,
  isConnected,
  leaveVoice,
  presenceOf,
  presenceOfFriends,
  setFriends,
  setVoiceUser,
  socketIdsOf,
  voiceDeparture,
} from "./state";

/**
 * Porta de servico entre o app web e o gateway.
 *
 * Por que existe: o socket entra nas salas de um servidor quando a pessoa
 * entra nele, e nunca recalcula sozinho. Duas rotas, duas gravidades:
 *
 *  - `/internal/evict` — a pessoa deixou de ser membro (kick, ban, saiu).
 *    Tira o socket de TODAS as salas do servidor e avisa a interface dele.
 *  - `/internal/server-deleted` — o servidor inteiro deixou de existir.
 *    Mesmo efeito do evict, so que para cada membro de uma vez — reaproveita
 *    a mesma funcao, so trocando o motivo mostrado.
 *  - `/internal/resync-rooms` — a pessoa continua membro, mas o que ela pode
 *    VER mudou (cargo editado, cargo atribuido, canal virou privado, acesso
 *    de canal privado mudou). Recalcula so as salas de canal, sem tirar
 *    ninguem do servidor nem avisar a interface — a mudanca de leitura e
 *    silenciosa, do mesmo jeito que ela ja era invisivel antes.
 *  - `/internal/friends-changed` — a lista de amizades de alguem mudou. O
 *    gateway guarda os amigos em memoria para nao consultar o banco a cada
 *    mudanca de presenca; sem este aviso, aceitar um pedido so passaria a
 *    valer na proxima reconexao dos dois.
 *  - `/internal/profile-changed` — a pessoa mudou a propria foto, moldura ou
 *    nome de exibicao. O `PublicUser` fica congelado no handshake e copiado
 *    para a ocupacao de voz; sem este aviso a foto nova so aparecia no card de
 *    voz depois de reconectar o socket.
 *  - `/internal/voice-token` / `/internal/voice-leave` — o Music Bot
 *    experimental entra/sai de canal de voz pela REST v1 (`/api/v1/channels/
 *    :id/voice`), que roda na Vercel sem `io` nem estado de ocupacao deste
 *    processo. Chamam `entrarNaVoz`/`sairDaVoz` (`./entrar-em-voz.ts`) — a
 *    MESMA autorizacao e ocupacao que `voice:join`/`voice:leave` usam para
 *    humano, so chegando por outra porta.
 *
 * Sem a primeira, apagar a linha no banco nao bastava — a pessoa continuaria
 * recebendo o chat pelo socket ate recarregar a pagina: acesso indevido, nao
 * interface desatualizada. Sem a segunda, o mesmo valia para qualquer
 * mudanca de permissao que nao fosse remocao total.
 *
 * Quem chama e o servidor do Next, nunca o navegador. A autenticacao e o
 * AUTH_SECRET que os dois lados ja compartilham para validar sessao — sem
 * variavel nova para configurar errado.
 */

const HEADER = "x-aether-internal";

/** Comparacao em tempo constante: igualdade simples vaza o segredo por tempo. */
function secretMatches(provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(env.authSecret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function readJsonBody(
  request: IncomingMessage,
  limite = 4096,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      // Nada legitimo aqui passa disto; corta payload absurdo. O padrao serve
      // aos avisos curtos; `/internal/send-message` passa um limite maior (uma
      // mensagem vai a 4000 chars).
      if (raw.length > limite) reject(new Error("payload grande demais"));
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("json invalido"));
      }
    });
    request.on("error", reject);
  });
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/**
 * Tira o usuario das salas de um servidor e avisa a interface dele.
 *
 * Nao derruba a conexao inteira: a pessoa pode participar de outros servidores,
 * e desconectar tudo puniria o que nao tem relacao com a moderacao.
 *
 * NAO usa `io.sockets.sockets.get(socketId)` (a busca so enxerga sockets
 * LOCAIS a esta instancia) — desde a fase 7c-2 o socket de quem esta sendo
 * expulso pode estar em OUTRA maquina de gateway. `io.to(room.user(...))` e
 * `io.in(room.user(...)).socketsLeave(...)` sao os metodos do proprio
 * Socket.IO pensados para isso: funcionam entre instancias com o adapter de
 * Redis, e continuam funcionando sem ele (uma instancia so) exatamente como
 * antes.
 */
async function evict(
  io: AetherServer,
  serverId: string,
  userId: string,
  reason = "Voce nao faz mais parte deste servidor.",
): Promise<number> {
  const userRoom = room.user(userId);
  const socketsDoUsuario = await io.in(userRoom).fetchSockets();
  if (socketsDoUsuario.length === 0) return 0;

  // Precisamos dos canais para sair das salas certas: o socket pode estar em
  // salas de canal de OUTROS servidores, que nao devem ser tocadas.
  const channels = await prisma.channel.findMany({
    where: { serverId },
    select: { id: true },
  });
  const channelRooms = channels.map((channel) => room.channel(channel.id));

  const left = await leaveVoice(userId);
  if (left && left.serverId === serverId) {
    io.to(room.server(serverId)).emit("voice:update", {
      serverId,
      participant: voiceDeparture(userId, left.user),
    });
  }

  io.to(userRoom).emit("server:evicted", { serverId, reason });
  await io.in(userRoom).socketsLeave([room.server(serverId), ...channelRooms]);

  return socketsDoUsuario.length;
}

/** Devolve `true` quando a requisicao foi tratada aqui. */
export async function handleInternalRequest(
  io: AetherServer,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  if (!request.url?.startsWith("/internal/")) return false;

  if (!secretMatches(request.headers[HEADER] as string | undefined)) {
    // Sem detalhe: quem chamou nao precisa saber se o caminho existe.
    json(response, 404, { ok: false });
    return true;
  }

  if (request.method !== "POST") {
    json(response, 404, { ok: false });
    return true;
  }

  if (request.url === "/internal/evict") {
    try {
      const body = (await readJsonBody(request)) as {
        serverId?: unknown;
        userId?: unknown;
      };
      if (
        typeof body.serverId !== "string" ||
        typeof body.userId !== "string"
      ) {
        json(response, 400, {
          ok: false,
          error: "serverId e userId sao obrigatorios",
        });
        return true;
      }

      const affected = await evict(io, body.serverId, body.userId);
      json(response, 200, { ok: true, sockets: affected });
    } catch (error) {
      log.error("gateway.internal.evict", "/internal/evict falhou", { err: error });
      json(response, 500, { ok: false });
    }
    return true;
  }

  if (request.url === "/internal/server-deleted") {
    try {
      const body = (await readJsonBody(request)) as {
        serverId?: unknown;
        userIds?: unknown;
      };
      if (typeof body.serverId !== "string" || !Array.isArray(body.userIds)) {
        json(response, 400, {
          ok: false,
          error: "serverId e userIds sao obrigatorios",
        });
        return true;
      }
      const userIds = body.userIds.filter(
        (id): id is string => typeof id === "string",
      );

      /**
       * Um `evict` por membro, e nao uma rota bulk dedicada: reaproveita a
       * mesma logica ja testada do kick/ban (salas de canal, saida de voz,
       * o evento) em vez de duplica-la. Custo aceito: a consulta dos canais
       * do servidor se repete a cada membro — servidor tem poucas dezenas de
       * pessoas, e a alternativa seria uma segunda versao da mesma funcao so
       * para poupar uma query que ja e rapida.
       */
      let affected = 0;
      for (const userId of userIds) {
        affected += await evict(
          io,
          body.serverId,
          userId,
          "Este servidor foi excluido.",
        );
      }

      json(response, 200, { ok: true, sockets: affected });
    } catch (error) {
      log.error("gateway.internal.server_deleted", "/internal/server-deleted falhou", {
        err: error,
      });
      json(response, 500, { ok: false });
    }
    return true;
  }

  if (request.url === "/internal/resync-rooms") {
    try {
      const body = (await readJsonBody(request)) as {
        serverId?: unknown;
        canalExcluidoId?: unknown;
      };
      if (typeof body.serverId !== "string") {
        json(response, 400, { ok: false, error: "serverId e obrigatorio" });
        return true;
      }

      /**
       * O canal em si sumiu (nao so uma mudanca de quem ve o que) — quem
       * estava DENTRO da call precisa sair de verdade, nao so parar de
       * receber a sala de roteamento de chat. `resyncEavisarServidor` sozinho
       * nunca mexeu em ocupacao de voz; sem isto a call ficava orfa (LiveKit
       * vivo, ocupacao apontando pra um canal que nao existe mais no banco).
       */
      if (typeof body.canalExcluidoId === "string") {
        await sairDaVozDoCanal(io, body.serverId, body.canalExcluidoId);
      }

      await resyncEavisarServidor(io, body.serverId);

      json(response, 200, { ok: true });
    } catch (error) {
      log.error("gateway.internal.resync_rooms", "/internal/resync-rooms falhou", {
        err: error,
      });
      json(response, 500, { ok: false });
    }
    return true;
  }

  /**
   * Derruba todos os sockets de um usuario — usado ao silenciar globalmente.
   *
   * As sessoes ja foram revogadas pelo lado do web; isto so garante que os
   * sockets JA ABERTOS caiam agora, em vez de continuarem valendo com o
   * `socket.data` congelado do handshake ate a proxima queda. `io.in(id)` usa
   * o adapter, entao alcanca sockets de outras instancias.
   */
  if (request.url === "/internal/desconectar-usuario") {
    try {
      const body = (await readJsonBody(request)) as { userId?: unknown };
      if (typeof body.userId !== "string") {
        json(response, 400, { ok: false, error: "userId e obrigatorio" });
        return true;
      }
      const sockets = await socketIdsOf(body.userId);
      for (const id of sockets) io.in(id).disconnectSockets(true);
      json(response, 200, { ok: true, sockets: sockets.length });
    } catch (error) {
      log.error(
        "gateway.internal.desconectar_usuario",
        "/internal/desconectar-usuario falhou",
        { err: error },
      );
      json(response, 500, { ok: false });
    }
    return true;
  }

  /**
   * Quantos estao online agora em cada servidor pedido.
   *
   * A UNICA rota interna que existe para RESPONDER algo, e nao para receber um
   * aviso. A razao: a presenca vive so na memoria deste processo, e o app web
   * nao tem como saber sozinho — o banco guarda a PREFERENCIA de status (a
   * pessoa escolheu DND), nunca quem esta de fato conectado.
   *
   * Responde o mapa completo, inclusive os zerados: aqui zero e uma afirmacao
   * verdadeira ("ninguem deste servidor esta conectado"). Quem distingue zero
   * de "nao sei" e o lado do web, que devolve nulo quando esta chamada inteira
   * falha.
   *
   * Nao valida se o servidor existe: quem pergunta ja leu a lista do banco, e
   * um id inventado simplesmente devolve zero. O teto de ids evita que uma
   * chamada gigante prenda o processo que atende as conversas.
   */
  if (request.url === "/internal/presenca-de-servidores") {
    try {
      const body = (await readJsonBody(request)) as { serverIds?: unknown };
      const ids = Array.isArray(body.serverIds)
        ? body.serverIds.filter((id): id is string => typeof id === "string")
        : [];

      const online: Record<string, number> = {};
      for (const serverId of ids.slice(0, 200)) {
        online[serverId] = (await presenceOf(serverId)).length;
      }
      json(response, 200, { ok: true, online });
    } catch (error) {
      log.error(
        "gateway.internal.presenca_de_servidores",
        "/internal/presenca-de-servidores falhou",
        { err: error },
      );
      json(response, 500, { ok: false });
    }
    return true;
  }

  /**
   * Quantas pessoas ocupam agora cada canal de voz pedido.
   *
   * Mesma natureza do `/internal/presenca-de-servidores`: RESPONDE algo que so
   * vive na memoria do gateway. A tela de Grupos (fase 2, estagio 4) monta a
   * lista de salas pelo BANCO, mas quem esta dentro de cada uma so o gateway
   * sabe. Zero e afirmacao ("sala vazia"), nao "nao sei" — o lado do web e que
   * devolve nulo quando a chamada inteira falha.
   */
  if (request.url === "/internal/ocupacao-de-canais") {
    try {
      const body = (await readJsonBody(request)) as { channelIds?: unknown };
      const ids = Array.isArray(body.channelIds)
        ? body.channelIds.filter((id): id is string => typeof id === "string")
        : [];

      const ocupacao: Record<string, number> = {};
      for (const channelId of ids.slice(0, 300)) {
        ocupacao[channelId] = await countInChannel(channelId);
      }
      json(response, 200, { ok: true, ocupacao });
    } catch (error) {
      log.error(
        "gateway.internal.ocupacao_de_canais",
        "/internal/ocupacao-de-canais falhou",
        { err: error },
      );
      json(response, 500, { ok: false });
    }
    return true;
  }

  if (request.url === "/internal/friends-changed") {
    try {
      const body = (await readJsonBody(request)) as { userIds?: unknown };
      const ids = Array.isArray(body.userIds)
        ? body.userIds.filter((id): id is string => typeof id === "string")
        : [];
      if (ids.length === 0) {
        json(response, 400, { ok: false, error: "userIds e obrigatorio" });
        return true;
      }

      let atualizados = 0;
      for (const userId of ids) {
        /**
         * Quem nao esta conectado nao tem estado em memoria para corrigir — e
         * vai carregar a lista nova no proximo `connection` de qualquer jeito.
         */
        if (!(await isConnected(userId))) continue;
        await setFriends(userId, await loadFriendIds(userId));
        /**
         * Os dois eventos, e nesta ordem. `friend:changed` faz a tela pedir a
         * lista nova ao Next (que e quem sabe montar "pendente"/"aceito");
         * `friend:sync` reentrega a presenca de quem esta online agora, porque
         * um amigo recem-aceito ja pode estar conectado ha horas e nunca mais
         * emitiria um evento por conta propria.
         */
        io.to(room.user(userId)).emit("friend:changed");
        io.to(room.user(userId)).emit("friend:sync", {
          entries: await presenceOfFriends(userId),
        });
        atualizados += 1;
      }

      json(response, 200, { ok: true, atualizados });
    } catch (error) {
      log.error("gateway.internal.friends_changed", "/internal/friends-changed falhou", {
        err: error,
      });
      json(response, 500, { ok: false });
    }
    return true;
  }

  if (request.url === "/internal/profile-changed") {
    try {
      const body = (await readJsonBody(request)) as { userId?: unknown };
      if (typeof body.userId !== "string") {
        json(response, 400, { ok: false, error: "userId e obrigatorio" });
        return true;
      }
      const userId = body.userId;

      /**
       * Quem nao esta conectado nao tem snapshot em memoria para corrigir — o
       * proximo handshake ja carrega o perfil novo.
       */
      if (!(await isConnected(userId))) {
        json(response, 200, { ok: true, atualizado: false });
        return true;
      }

      const row = await prisma.user.findUnique({
        where: { id: userId },
        select: SELECT_USUARIO_PUBLICO,
      });
      if (!row) {
        json(response, 404, { ok: false });
        return true;
      }
      const publicUser = toPublicUser(row);

      /**
       * 1. A foto/nome no card de voz. O `PublicUser` fica gravado na ocupacao
       * (foi tirado quando a pessoa entrou na call), entao trocamos ali e
       * reemitimos para o servidor inteiro da call — e assim que a foto nova
       * chega a quem esta na call com ela, sem ninguem reconectar.
       */
      const voz = await setVoiceUser(userId, publicUser);
      if (voz) {
        io.to(room.server(voz.serverId)).emit("voice:update", {
          serverId: voz.serverId,
          participant: voz.participant,
        });
      }

      /**
       * 2. `socket.data.user` dos sockets LOCAIS — congela no handshake, e sem
       * isto o proximo `voice:join` (ou mensagem) desta conexao ainda gravaria
       * o snapshot velho. Best-effort numa so instancia; com Redis, a instancia
       * que segura o socket pode ser outra — anotado nas limitacoes.
       */
      for (const s of io.sockets.sockets.values()) {
        // Merge: o perfil muda so os campos publicos; `equipe`/`silenciado*`
        // continuam os do handshake.
        if (s.data.userId === userId) {
          s.data.user = { ...s.data.user, ...publicUser };
        }
      }

      /**
       * 3. Amigos: a tela deles re-renderiza (o componente de servidor pega a
       * foto nova do banco). Mesmo evento do `/internal/friends-changed`, sem o
       * `friend:sync` — presenca nao mudou, so o perfil.
       */
      for (const amigoId of await loadFriendIds(userId)) {
        if (await isConnected(amigoId)) {
          io.to(room.user(amigoId)).emit("friend:changed");
        }
      }

      json(response, 200, { ok: true, atualizado: true });
    } catch (error) {
      log.error("gateway.internal.profile_changed", "/internal/profile-changed falhou", {
        err: error,
      });
      json(response, 500, { ok: false });
    }
    return true;
  }

  /**
   * Publica uma mensagem no lugar de um ator — hoje só a REST v1 de bots
   * (`POST /api/v1/channels/:id/messages`), que roda na Vercel e nao tem o `io`
   * deste processo. O gateway continua sendo o UNICO que escreve mensagem:
   * `enviarMensagem` e o mesmo caminho do `message:send` humano, com a mesma
   * autorizacao (`autorizarConversa` -> `loadMemberAccess` do bot -> permissao
   * de canal).
   */
  if (request.url === "/internal/send-message") {
    try {
      const body = (await readJsonBody(request, 64 * 1024)) as {
        atorUserId?: unknown;
        conversationId?: unknown;
        content?: unknown;
        replyToId?: unknown;
        origem?: unknown;
      };
      if (
        typeof body.atorUserId !== "string" ||
        typeof body.conversationId !== "string"
      ) {
        json(response, 400, {
          ok: false,
          error: "atorUserId e conversationId sao obrigatorios",
        });
        return true;
      }

      /**
       * So a rota do webhook manda "webhook" — o resto (bot da REST v1) cai no
       * default "api". E o que decide, dentro de `enviarMensagem`, se o ator
       * precisa ser `ServerMember` ou nao (ver `autorizarCanalDeWebhook`).
       */
      const origem = body.origem === "webhook" ? "webhook" : "api";

      /**
       * Leitura FRESCA do silenciamento — diferente do socket, que usa o
       * snapshot do handshake. Um bot silenciado agora nao publica.
       */
      const ator = await prisma.user.findUnique({
        where: { id: body.atorUserId },
        select: { id: true, silenciadoEm: true, silenciadoAte: true },
      });
      if (!ator) {
        json(response, 404, { ok: false });
        return true;
      }

      const resultado = await enviarMensagem(io, {
        ator,
        conversationId: body.conversationId,
        content: body.content,
        replyToId: body.replyToId,
        nonce: null,
        origem,
      });
      json(response, 200, resultado);
    } catch (error) {
      log.error("gateway.internal.send_message", "/internal/send-message falhou", {
        err: error,
      });
      json(response, 500, { ok: false });
    }
    return true;
  }

  /**
   * O Music Bot pede entrada num canal de voz. `entrarNaVoz` e o MESMO
   * caminho de `voice:join` (autorizacao, ocupacao, token do LiveKit) — so
   * muda quem chama. `socketId` sintetico ("bot:<id>") porque o bot nao tem
   * socket nenhum aberto aqui; e o que amarra a ocupacao dele para
   * `/internal/voice-leave` (ou uma reconexao) encontrar depois.
   */
  if (request.url === "/internal/voice-token") {
    try {
      const body = (await readJsonBody(request)) as {
        botUserId?: unknown;
        channelId?: unknown;
      };
      if (
        typeof body.botUserId !== "string" ||
        typeof body.channelId !== "string"
      ) {
        json(response, 400, {
          ok: false,
          error: "botUserId e channelId sao obrigatorios",
        });
        return true;
      }

      const row = await prisma.user.findUnique({
        where: { id: body.botUserId },
        select: SELECT_USUARIO_PUBLICO,
      });
      if (!row) {
        json(response, 404, { ok: false });
        return true;
      }

      const resultado = await entrarNaVoz(io, {
        userId: body.botUserId,
        user: toPublicUser(row),
        channelId: body.channelId,
        socketId: `bot:${body.botUserId}`,
      });
      json(response, 200, resultado);
    } catch (error) {
      log.error("gateway.internal.voice_token", "/internal/voice-token falhou", {
        err: error,
      });
      json(response, 500, { ok: false });
    }
    return true;
  }

  /** O Music Bot avisa que esta saindo do canal de voz. Idempotente. */
  if (request.url === "/internal/voice-leave") {
    try {
      const body = (await readJsonBody(request)) as { botUserId?: unknown };
      if (typeof body.botUserId !== "string") {
        json(response, 400, { ok: false, error: "botUserId e obrigatorio" });
        return true;
      }

      const saiu = await sairDaVoz(io, {
        userId: body.botUserId,
        onlyIfSocket: `bot:${body.botUserId}`,
      });
      json(response, 200, { ok: true, saiu });
    } catch (error) {
      log.error("gateway.internal.voice_leave", "/internal/voice-leave falhou", {
        err: error,
      });
      json(response, 500, { ok: false });
    }
    return true;
  }

  json(response, 404, { ok: false });
  return true;
}
