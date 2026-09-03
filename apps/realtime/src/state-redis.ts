import type { Redis } from "ioredis";
import type {
  MusicActivity,
  PresenceEntry,
  PublicUser,
  UserStatus,
  VoiceParticipant,
} from "@aether/shared";
import type { StateStore } from "./state-store";

/**
 * Estado vivo do gateway, no Redis — varias instancias (fase 7c-2).
 *
 * O DESENHO GERAL: cada usuario conectado tem um Hash de presenca e um de
 * voz (quando esta numa call); Sets fazem os indices inversos (quem esta num
 * servidor, quem esta num canal). Isso e o mesmo desenho dos `Map` da versao
 * em memoria, so que compartilhado — qualquer instancia le o estado que
 * outra escreveu.
 *
 * POR QUE LUA SO EM DOIS LUGARES (entrar/sair de servidor), e nao em tudo:
 * o resto das operacoes (trocar status, marcar quem fala, mutar) e sempre
 * disparado pela PROPRIA pessoa ou por UM moderador agindo sobre ela — o
 * mesmo usuario nao aciona dois clientes mandando o mesmo tipo de evento no
 * mesmo milissegundo em duas maquinas diferentes, entao um GET+SET comum ja
 * era o que a versao em memoria fazia (so que la a serializacao vinha de
 * graca, do event loop de um processo so). A contagem de "sou a primeira
 * pessoa deste servidor" e diferente: ela decide se avisa todo mundo que
 * alguem "ficou presente", e duas pessoas ENTRANDO ao mesmo tempo em
 * instancias diferentes e um caso real, nao hipotetico — por isso os dois
 * scripts, no mesmo espirito do rate limit e do ticket unico que ja existiam
 * (`packages/shared/src/redis.ts`).
 *
 * NAO HA LIMPEZA POR TTL. Uma queda graciosa do processo (o `shutdown` em
 * `index.ts`, o que `fly deploy` faz numa atualizacao normal) dispara o
 * `disconnect` de cada socket e o Redis fica limpo, exatamente como a versao
 * em memoria fica limpa ao reiniciar. Uma queda NAO graciosa (OOM, `fly
 * machine kill`) deixa a entrada para tras — a versao em memoria "resolvia"
 * isso derrubando o processo inteiro; aqui isso vira um fantasma ate alguem
 * notar. Documentado como limitacao no README, nao resolvido aqui.
 */

const P_USER = (id: string) => `gw:p:user:${id}`;
const P_USER_SOCKETS = (id: string) => `gw:p:user:${id}:sockets`;
const P_USER_FRIENDS = (id: string) => `gw:p:user:${id}:friends`;
const P_USER_SERVERS = (id: string) => `gw:p:user:${id}:servers`;
const P_SOCKET = (id: string) => `gw:p:socket:${id}`;
const P_SOCKET_SERVERS = (id: string) => `gw:p:socket:${id}:servers`;
const P_SERVER_MEMBERS = (id: string) => `gw:p:server:${id}:members`;
const P_ALL_USERS = "gw:p:allusers";
const P_ALL_SOCKETS = "gw:p:allsockets";
const P_ACTIVE_SERVERS = "gw:p:activeservers";

const V_USER = (id: string) => `gw:v:user:${id}`;
const V_SERVER_MEMBERS = (id: string) => `gw:v:server:${id}:members`;
const V_CHANNEL_MEMBERS = (id: string) => `gw:v:channel:${id}:members`;
const V_ALL_USERS = "gw:v:allusers";

/** `null` vira string vazia no Redis; volta a `null` na leitura. */
function encField(v: string | null | undefined): string {
  return v ?? "";
}
function decField(v: string | undefined): string | null {
  return v && v.length > 0 ? v : null;
}
function encBool(v: boolean): string {
  return v ? "1" : "0";
}
function decBool(v: string | undefined): boolean {
  return v === "1";
}

/** `listening` mora no hash como JSON (ou string vazia). */
function decListening(v: string | undefined): MusicActivity | null {
  if (!v) return null;
  try {
    return JSON.parse(v) as MusicActivity;
  } catch {
    return null;
  }
}

function hashToEntry(userId: string, h: Record<string, string>): PresenceEntry {
  return {
    userId,
    status: (h.status as UserStatus) ?? "OFFLINE",
    game: decField(h.game),
    gameSince: h.gameSince ? new Date(Number(h.gameSince)).toISOString() : null,
    gameIcon: decField(h.gameIcon),
    gameCover: decField(h.gameCover),
    listening: decListening(h.listening),
  };
}

/**
 * Le um hash de voz ja sabido completo (quem chama ja conferiu `h.serverId`).
 * As asserções `!` aqui refletem essa garantia: `joinVoice` sempre grava
 * TODOS os campos de uma vez, e `HSET` so acrescenta/atualiza — nenhuma
 * escrita parcial depois disso derruba um campo que ja existia.
 */
function hashToParticipant(
  userId: string,
  h: Record<string, string>,
): VoiceParticipant {
  const selfMuted = decBool(h.selfMuted);
  const serverMuted = decBool(h.serverMuted);
  return {
    userId,
    channelId: h.channelId ?? null,
    selfMuted,
    selfDeafened: decBool(h.selfDeafened),
    serverMuted,
    serverDeafened: decBool(h.serverDeafened),
    streaming: decBool(h.streaming),
    camera: decBool(h.camera),
    speaking: decBool(h.speaking) && !selfMuted && !serverMuted,
    joinedAt: h.joinedAt ? new Date(Number(h.joinedAt)).toISOString() : null,
    user: JSON.parse(h.user!) as PublicUser,
  };
}

/**
 * "Entrar num servidor" e atomico: SADD na propria ocupacao do socket, e so
 * quando ela era nova, HINCRBY no contador do usuario naquele servidor. O
 * contador virando 1 e o que decide "ficou presente agora" — e exatamente
 * por precisar decidir isso sem re-ler o proprio incremento que isto e Lua e
 * nao dois comandos separados.
 */
const JOIN_SERVER_LUA = `
local added = redis.call('SADD', KEYS[1], ARGV[1])
if added == 0 then
  return 0
end
local newcount = redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
redis.call('SADD', KEYS[3], ARGV[2])
if newcount == 1 then
  redis.call('SADD', KEYS[4], ARGV[1])
  return 1
end
return 0
`;

/** Espelho do de entrar: sai da ocupacao do socket, decrementa, e so quando chega a zero desindexar. */
const LEAVE_SERVER_LUA = `
local removed = redis.call('SREM', KEYS[1], ARGV[1])
if removed == 0 then
  return 0
end
local newcount = redis.call('HINCRBY', KEYS[2], ARGV[1], -1)
if newcount > 0 then
  return 0
end
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('SREM', KEYS[3], ARGV[2])
redis.call('SREM', KEYS[4], ARGV[1])
return 1
`;

export function createRedisStore(redis: Redis): StateStore {
  async function leaveServerFor(
    userId: string,
    socketId: string,
    serverId: string,
  ): Promise<boolean> {
    const result = (await redis.eval(
      LEAVE_SERVER_LUA,
      4,
      P_SOCKET_SERVERS(socketId),
      P_USER_SERVERS(userId),
      P_SERVER_MEMBERS(serverId),
      P_ACTIVE_SERVERS,
      serverId,
      userId,
    )) as number;
    return result === 1;
  }

  return {
    async attachSocket(socketId, userId, initialStatus) {
      await redis.set(P_SOCKET(socketId), userId);
      await redis.sadd(P_ALL_SOCKETS, socketId);
      await redis.sadd(P_USER_SOCKETS(userId), socketId);

      const existed = (await redis.exists(P_USER(userId))) === 1;
      if (!existed) {
        const status: UserStatus =
          initialStatus === "OFFLINE" ? "ONLINE" : initialStatus;
        await redis.hset(P_USER(userId), {
          status,
          game: "",
          gameSince: "",
          gameIcon: "",
          gameCover: "",
          listening: "",
        });
        await redis.sadd(P_ALL_USERS, userId);
      }
    },

    async statusOf(userId) {
      const status = await redis.hget(P_USER(userId), "status");
      return (status as UserStatus | null) ?? "OFFLINE";
    },

    async setGame(userId, game, icon = null) {
      const existed = (await redis.exists(P_USER(userId))) === 1;
      if (!existed) return null;

      const [curGame, curIcon] = await redis.hmget(
        P_USER(userId),
        "game",
        "gameIcon",
      );
      const nomeMudou = decField(curGame ?? undefined) !== game;
      const iconeMudou =
        game !== null && decField(curIcon ?? undefined) !== icon;
      if (!nomeMudou && !iconeMudou) return null;

      const patch: Record<string, string> = {
        game: encField(game),
        gameIcon: encField(game ? icon : null),
      };
      if (nomeMudou) {
        patch.gameSince = encField(game ? String(Date.now()) : null);
        patch.gameCover = "";
      }
      await redis.hset(P_USER(userId), patch);

      const servers = await redis.hkeys(P_USER_SERVERS(userId));
      const h = await redis.hgetall(P_USER(userId));
      return { servers, entry: hashToEntry(userId, h), nomeMudou };
    },

    async setListening(userId, listening) {
      const h = await redis.hgetall(P_USER(userId));
      if (!h.status) return null;

      const antes = decListening(h.listening);
      const igual =
        antes?.title === listening?.title &&
        antes?.artists === listening?.artists &&
        antes?.url === listening?.url;
      if (igual) return null;

      await redis.hset(P_USER(userId), {
        listening: listening ? JSON.stringify(listening) : "",
      });

      const servers = await redis.hkeys(P_USER_SERVERS(userId));
      const atualizado = await redis.hgetall(P_USER(userId));
      return { servers, entry: hashToEntry(userId, atualizado) };
    },

    async setGameCover(userId, jogoEsperado, cover, displayName) {
      const h = await redis.hgetall(P_USER(userId));
      if (!h.status) return null;
      if (h.game !== jogoEsperado) return null;

      const nomeNovo =
        displayName && displayName !== h.game ? displayName : null;
      if (!cover && !nomeNovo) return null;
      if (cover === decField(h.gameCover) && !nomeNovo) return null;

      const patch: Record<string, string> = {};
      if (cover) patch.gameCover = cover;
      if (nomeNovo) patch.game = nomeNovo;
      await redis.hset(P_USER(userId), patch);

      const servers = await redis.hkeys(P_USER_SERVERS(userId));
      const atualizado = await redis.hgetall(P_USER(userId));
      return { servers, entry: hashToEntry(userId, atualizado) };
    },

    async presenceEntryOf(userId) {
      const h = await redis.hgetall(P_USER(userId));
      if (!h.status) return null;
      return hashToEntry(userId, h);
    },

    async joinServer(socketId, serverId) {
      const userId = await redis.get(P_SOCKET(socketId));
      if (!userId) return false;
      const result = (await redis.eval(
        JOIN_SERVER_LUA,
        4,
        P_SOCKET_SERVERS(socketId),
        P_USER_SERVERS(userId),
        P_SERVER_MEMBERS(serverId),
        P_ACTIVE_SERVERS,
        serverId,
        userId,
      )) as number;
      return result === 1;
    },

    async leaveServer(socketId, serverId) {
      const userId = await redis.get(P_SOCKET(socketId));
      if (!userId) return false;
      return leaveServerFor(userId, socketId, serverId);
    },

    async detachSocket(socketId) {
      const userId = await redis.get(P_SOCKET(socketId));
      if (!userId) return { userId: null, vacatedServers: [] };

      const serverIds = await redis.smembers(P_SOCKET_SERVERS(socketId));
      const vacated: string[] = [];
      for (const serverId of serverIds) {
        if (await leaveServerFor(userId, socketId, serverId))
          vacated.push(serverId);
      }
      await redis.del(P_SOCKET_SERVERS(socketId), P_SOCKET(socketId));
      await redis.srem(P_ALL_SOCKETS, socketId);

      await redis.srem(P_USER_SOCKETS(userId), socketId);
      const remaining = await redis.scard(P_USER_SOCKETS(userId));
      if (remaining === 0) {
        await redis.del(
          P_USER(userId),
          P_USER_SOCKETS(userId),
          P_USER_FRIENDS(userId),
          P_USER_SERVERS(userId),
        );
        await redis.srem(P_ALL_USERS, userId);
      }

      return { userId, vacatedServers: vacated };
    },

    async setStatus(userId, status) {
      const existed = (await redis.exists(P_USER(userId))) === 1;
      if (!existed) return [];
      await redis.hset(P_USER(userId), "status", status);
      return await redis.hkeys(P_USER_SERVERS(userId));
    },

    async presenceOf(serverId) {
      const userIds = await redis.smembers(P_SERVER_MEMBERS(serverId));
      if (userIds.length === 0) return [];
      const pipeline = redis.pipeline();
      for (const id of userIds) pipeline.hgetall(P_USER(id));
      const results = await pipeline.exec();
      const entries: PresenceEntry[] = [];
      results?.forEach(([err, h], i) => {
        const hash = h as Record<string, string>;
        if (err || !hash?.status) return;
        entries.push(hashToEntry(userIds[i]!, hash));
      });
      return entries;
    },

    async setFriends(userId, friendIds) {
      const existed = (await redis.exists(P_USER(userId))) === 1;
      if (!existed) return;
      const key = P_USER_FRIENDS(userId);
      const pipeline = redis.pipeline();
      pipeline.del(key);
      if (friendIds.length > 0) pipeline.sadd(key, ...friendIds);
      await pipeline.exec();
    },

    async friendsOf(userId) {
      return await redis.smembers(P_USER_FRIENDS(userId));
    },

    async isConnected(userId) {
      return (await redis.exists(P_USER(userId))) === 1;
    },

    async presenceOfFriends(userId) {
      const friends = await redis.smembers(P_USER_FRIENDS(userId));
      if (friends.length === 0) return [];
      const pipeline = redis.pipeline();
      for (const id of friends) pipeline.hgetall(P_USER(id));
      const results = await pipeline.exec();
      const entries: PresenceEntry[] = [];
      results?.forEach(([err, h], i) => {
        const hash = h as Record<string, string>;
        if (err || !hash?.status) return;
        entries.push(hashToEntry(friends[i]!, hash));
      });
      return entries;
    },

    async socketIdsOf(userId) {
      return await redis.smembers(P_USER_SOCKETS(userId));
    },

    async stats() {
      const [socketsN, usersN, serversN, inVoiceN] = await Promise.all([
        redis.scard(P_ALL_SOCKETS),
        redis.scard(P_ALL_USERS),
        redis.scard(P_ACTIVE_SERVERS),
        redis.scard(V_ALL_USERS),
      ]);
      return {
        sockets: socketsN,
        users: usersN,
        servers: serversN,
        inVoice: inVoiceN,
      };
    },

    async voiceParticipant(userId) {
      const h = await redis.hgetall(V_USER(userId));
      if (!h.serverId) return null;
      return hashToParticipant(userId, h);
    },

    async joinVoice(params) {
      const { socketId, userId, user, serverId, channelId } = params;
      const previous = await redis.hgetall(V_USER(userId));
      const hasPrevious = Boolean(previous.serverId);
      // Presente sempre que `hasPrevious` e verdade — mesmo motivo do `!` em
      // `hashToParticipant`: os campos do hash de voz sao gravados juntos.
      const previousChannelId = previous.channelId;
      const previousServerId =
        hasPrevious && previous.serverId !== serverId
          ? previous.serverId!
          : null;

      if (previousServerId) {
        await redis.srem(V_SERVER_MEMBERS(previousServerId), userId);
        await redis.srem(V_CHANNEL_MEMBERS(previousChannelId!), userId);
      } else if (hasPrevious && previousChannelId !== channelId) {
        await redis.srem(V_CHANNEL_MEMBERS(previousChannelId!), userId);
      }

      const sameChannel = hasPrevious && previousChannelId === channelId;
      await redis.hset(V_USER(userId), {
        socketId,
        serverId,
        channelId,
        // Trocar de canal preserva mute/surdo; `??` cobre tanto "nunca esteve
        // em voz" quanto "estava" — os dois casos comecam de "0" se ausente.
        selfMuted: previous.selfMuted ?? "0",
        selfDeafened: previous.selfDeafened ?? "0",
        speaking: "0",
        streaming: "0",
        camera: "0",
        serverMuted: previous.serverMuted ?? "0",
        serverDeafened: previous.serverDeafened ?? "0",
        joinedAt: sameChannel
          ? (previous.joinedAt ?? String(Date.now()))
          : String(Date.now()),
        user: JSON.stringify(user),
      });
      await redis.sadd(V_SERVER_MEMBERS(serverId), userId);
      await redis.sadd(V_CHANNEL_MEMBERS(channelId), userId);
      await redis.sadd(V_ALL_USERS, userId);

      return { previousServerId };
    },

    async leaveVoice(userId, onlyIfSocket) {
      const h = await redis.hgetall(V_USER(userId));
      if (!h.serverId) return null;
      if (onlyIfSocket && h.socketId !== onlyIfSocket) return null;

      await redis.del(V_USER(userId));
      await redis.srem(V_SERVER_MEMBERS(h.serverId), userId);
      await redis.srem(V_CHANNEL_MEMBERS(h.channelId!), userId);
      await redis.srem(V_ALL_USERS, userId);

      return {
        serverId: h.serverId,
        channelId: h.channelId!,
        user: JSON.parse(h.user!) as PublicUser,
      };
    },

    async setVoiceFlags(userId, patch) {
      const existing = await redis.hgetall(V_USER(userId));
      if (!existing.serverId) return null;

      const next: Record<string, string> = {};
      if (typeof patch.selfMuted === "boolean")
        next.selfMuted = encBool(patch.selfMuted);
      if (typeof patch.selfDeafened === "boolean") {
        next.selfDeafened = encBool(patch.selfDeafened);
        if (patch.selfDeafened) next.selfMuted = "1";
      }
      if (Object.keys(next).length > 0) await redis.hset(V_USER(userId), next);

      // Rele em vez de mesclar localmente: `{...hash, campo}` some com a
      // assinatura de indice do TypeScript (Record<string,string> sem
      // propriedades nomeadas nao sobrevive ao spread) — reler e mais simples
      // que contornar isso, e o hash inteiro sempre existe (`joinVoice`
      // grava todos os campos juntos).
      const h = await redis.hgetall(V_USER(userId));
      return {
        serverId: h.serverId!,
        participant: hashToParticipant(userId, h),
      };
    },

    async voiceOfServer(serverId) {
      const userIds = await redis.smembers(V_SERVER_MEMBERS(serverId));
      if (userIds.length === 0) return [];
      const pipeline = redis.pipeline();
      for (const id of userIds) pipeline.hgetall(V_USER(id));
      const results = await pipeline.exec();
      const list: VoiceParticipant[] = [];
      results?.forEach(([err, h], i) => {
        const hash = h as Record<string, string>;
        if (err || !hash?.serverId) return;
        list.push(hashToParticipant(userIds[i]!, hash));
      });
      return list;
    },

    async countInChannel(channelId) {
      return await redis.scard(V_CHANNEL_MEMBERS(channelId));
    },

    async setVoiceSpeaking(userId, speaking) {
      const existing = await redis.hgetall(V_USER(userId));
      if (!existing.serverId) return null;
      if (decBool(existing.speaking) === speaking) return null;

      await redis.hset(V_USER(userId), "speaking", encBool(speaking));
      const h = await redis.hgetall(V_USER(userId));
      return {
        serverId: h.serverId!,
        participant: hashToParticipant(userId, h),
      };
    },

    async setVoiceCamera(userId, camera) {
      const existing = await redis.hgetall(V_USER(userId));
      if (!existing.serverId) return null;
      if (decBool(existing.camera) === camera) return null;

      await redis.hset(V_USER(userId), "camera", encBool(camera));
      const h = await redis.hgetall(V_USER(userId));
      return {
        serverId: h.serverId!,
        participant: hashToParticipant(userId, h),
      };
    },

    async setVoiceStreaming(userId, streaming) {
      const existing = await redis.hgetall(V_USER(userId));
      if (!existing.serverId) return null;
      if (decBool(existing.streaming) === streaming) return null;

      await redis.hset(V_USER(userId), "streaming", encBool(streaming));
      const h = await redis.hgetall(V_USER(userId));
      return {
        serverId: h.serverId!,
        participant: hashToParticipant(userId, h),
      };
    },

    async setVoiceUser(userId, user) {
      const existing = await redis.hgetall(V_USER(userId));
      if (!existing.serverId) return null;

      await redis.hset(V_USER(userId), "user", JSON.stringify(user));
      const h = await redis.hgetall(V_USER(userId));
      return {
        serverId: h.serverId!,
        participant: hashToParticipant(userId, h),
      };
    },

    async countStreaming(channelId) {
      const userIds = await redis.smembers(V_CHANNEL_MEMBERS(channelId));
      if (userIds.length === 0) return 0;
      const pipeline = redis.pipeline();
      for (const id of userIds) pipeline.hget(V_USER(id), "streaming");
      const results = await pipeline.exec();
      return results?.filter(([err, v]) => !err && v === "1").length ?? 0;
    },

    async voiceLocation(userId) {
      const [serverId, channelId] = await redis.hmget(
        V_USER(userId),
        "serverId",
        "channelId",
      );
      if (!serverId) return null;
      return { serverId, channelId: channelId! };
    },

    async setServerVoiceFlags(userId, patch) {
      const existing = await redis.hgetall(V_USER(userId));
      if (!existing.serverId) return null;

      const before = {
        muted: decBool(existing.serverMuted),
        deafened: decBool(existing.serverDeafened),
      };

      const next: Record<string, string> = {};
      if (typeof patch.serverMuted === "boolean")
        next.serverMuted = encBool(patch.serverMuted);
      if (typeof patch.serverDeafened === "boolean") {
        next.serverDeafened = encBool(patch.serverDeafened);
        if (patch.serverDeafened) next.serverMuted = "1";
      }

      const after = {
        muted:
          next.serverMuted !== undefined
            ? decBool(next.serverMuted)
            : before.muted,
        deafened:
          next.serverDeafened !== undefined
            ? decBool(next.serverDeafened)
            : before.deafened,
      };
      if (before.muted === after.muted && before.deafened === after.deafened)
        return null;

      if (Object.keys(next).length > 0) await redis.hset(V_USER(userId), next);
      const h = await redis.hgetall(V_USER(userId));
      return {
        serverId: h.serverId!,
        channelId: h.channelId!,
        participant: hashToParticipant(userId, h),
      };
    },

    async voiceSocketOf(userId) {
      return await redis.hget(V_USER(userId), "socketId");
    },
  };
}
