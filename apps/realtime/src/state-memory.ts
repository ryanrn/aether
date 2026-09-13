import type {
  MusicActivity,
  PresenceEntry,
  PublicUser,
  UserStatus,
  VoiceParticipant,
} from "@aether/shared";
import type { StateStore } from "./state-store";

/**
 * Estado vivo do gateway, em memoria — uma instancia so.
 *
 * E o que o gateway sempre usou, agora atras da interface `StateStore` para
 * poder trocar de lugar com `state-redis.ts` sem o resto do codigo notar.
 * O comportamento e IDENTICO ao de antes da fase 7c-2: cada funcao so ganhou
 * `async` na assinatura, o corpo continua sincrono.
 */

interface UserPresence {
  status: UserStatus;
  game: string | null;
  gameSince: number | null;
  gameIcon: string | null;
  gameCover: string | null;
  listening: MusicActivity | null;
  sockets: Set<string>;
  friends: Set<string>;
  servers: Map<string, number>;
}

const users = new Map<string, UserPresence>();
const sockets = new Map<string, { userId: string; servers: Set<string> }>();
const serverMembers = new Map<string, Set<string>>();

function toPresenceEntry(userId: string, user: UserPresence): PresenceEntry {
  return {
    userId,
    status: user.status,
    game: user.game,
    gameSince: user.gameSince ? new Date(user.gameSince).toISOString() : null,
    gameIcon: user.gameIcon,
    gameCover: user.gameCover,
    listening: user.listening,
  };
}

interface VoiceEntry {
  socketId: string;
  serverId: string;
  channelId: string;
  selfMuted: boolean;
  selfDeafened: boolean;
  speaking: boolean;
  streaming: boolean;
  camera: boolean;
  serverMuted: boolean;
  serverDeafened: boolean;
  joinedAt: number;
  user: PublicUser;
}

const voice = new Map<string, VoiceEntry>();
const voiceByServer = new Map<string, Set<string>>();

function toParticipant(userId: string, entry: VoiceEntry): VoiceParticipant {
  return {
    userId,
    channelId: entry.channelId,
    selfMuted: entry.selfMuted,
    selfDeafened: entry.selfDeafened,
    serverMuted: entry.serverMuted,
    serverDeafened: entry.serverDeafened,
    streaming: entry.streaming,
    camera: entry.camera,
    speaking: entry.speaking && !entry.selfMuted && !entry.serverMuted,
    joinedAt: new Date(entry.joinedAt).toISOString(),
    user: entry.user,
  };
}

function unindex(userId: string, serverId: string): void {
  const set = voiceByServer.get(serverId);
  if (!set) return;
  set.delete(userId);
  if (set.size === 0) voiceByServer.delete(serverId);
}

export const memoryStore: StateStore = {
  async attachSocket(socketId, userId, initialStatus) {
    sockets.set(socketId, { userId, servers: new Set() });

    const existing = users.get(userId);
    if (existing) {
      existing.sockets.add(socketId);
      return;
    }
    users.set(userId, {
      status: initialStatus === "OFFLINE" ? "ONLINE" : initialStatus,
      game: null,
      gameSince: null,
      gameIcon: null,
      gameCover: null,
      listening: null,
      sockets: new Set([socketId]),
      friends: new Set(),
      servers: new Map(),
    });
  },

  async statusOf(userId) {
    return users.get(userId)?.status ?? "OFFLINE";
  },

  async setGame(userId, game, icon = null) {
    const user = users.get(userId);
    if (!user) return null;

    const nomeMudou = user.game !== game;
    const iconeMudou = game !== null && user.gameIcon !== icon;
    if (!nomeMudou && !iconeMudou) return null;

    user.game = game;
    user.gameIcon = game ? icon : null;

    if (nomeMudou) {
      user.gameSince = game ? Date.now() : null;
      user.gameCover = null;
    }

    return {
      servers: [...user.servers.keys()],
      entry: toPresenceEntry(userId, user),
      nomeMudou,
    };
  },

  async setListening(userId, listening) {
    const user = users.get(userId);
    if (!user) return null;

    // Mesma faixa (id do link) e mesma capa: nada a anunciar.
    const antes = user.listening;
    const igual =
      antes?.title === listening?.title &&
      antes?.artists === listening?.artists &&
      antes?.url === listening?.url;
    if (igual) return null;

    user.listening = listening;
    return {
      servers: [...user.servers.keys()],
      entry: toPresenceEntry(userId, user),
    };
  },

  async setGameCover(userId, jogoEsperado, cover, displayName) {
    const user = users.get(userId);
    if (!user) return null;
    if (user.game !== jogoEsperado) return null;

    const nomeNovo =
      displayName && displayName !== user.game ? displayName : null;
    if (!cover && !nomeNovo) return null;
    if (cover === user.gameCover && !nomeNovo) return null;

    if (cover) user.gameCover = cover;
    if (nomeNovo) user.game = nomeNovo;

    return {
      servers: [...user.servers.keys()],
      entry: toPresenceEntry(userId, user),
    };
  },

  async presenceEntryOf(userId) {
    const user = users.get(userId);
    return user ? toPresenceEntry(userId, user) : null;
  },

  async joinServer(socketId, serverId) {
    const socket = sockets.get(socketId);
    const user = socket ? users.get(socket.userId) : undefined;
    if (!socket || !user) return false;
    if (socket.servers.has(serverId)) return false;

    socket.servers.add(serverId);
    const count = user.servers.get(serverId) ?? 0;
    user.servers.set(serverId, count + 1);

    const members = serverMembers.get(serverId) ?? new Set<string>();
    members.add(socket.userId);
    serverMembers.set(serverId, members);

    return count === 0;
  },

  async leaveServer(socketId, serverId) {
    const socket = sockets.get(socketId);
    const user = socket ? users.get(socket.userId) : undefined;
    if (!socket || !user) return false;
    if (!socket.servers.delete(serverId)) return false;

    const count = (user.servers.get(serverId) ?? 1) - 1;
    if (count > 0) {
      user.servers.set(serverId, count);
      return false;
    }

    user.servers.delete(serverId);
    const members = serverMembers.get(serverId);
    if (members) {
      members.delete(socket.userId);
      if (members.size === 0) serverMembers.delete(serverId);
    }
    return true;
  },

  async detachSocket(socketId) {
    const socket = sockets.get(socketId);
    if (!socket) return { userId: null, vacatedServers: [] };

    const vacated: string[] = [];
    for (const serverId of [...socket.servers]) {
      if (await memoryStore.leaveServer(socketId, serverId))
        vacated.push(serverId);
    }

    const user = users.get(socket.userId);
    if (user) {
      user.sockets.delete(socketId);
      if (user.sockets.size === 0) users.delete(socket.userId);
    }
    sockets.delete(socketId);

    return { userId: socket.userId, vacatedServers: vacated };
  },

  async setStatus(userId, status) {
    const user = users.get(userId);
    if (!user) return [];
    user.status = status;
    return [...user.servers.keys()];
  },

  async presenceOf(serverId) {
    const members = serverMembers.get(serverId);
    if (!members) return [];
    const entries: PresenceEntry[] = [];
    for (const userId of members) {
      const user = users.get(userId);
      if (user) entries.push(toPresenceEntry(userId, user));
    }
    return entries;
  },

  async setFriends(userId, friendIds) {
    const user = users.get(userId);
    if (!user) return;
    user.friends = new Set(friendIds);
  },

  async friendsOf(userId) {
    return [...(users.get(userId)?.friends ?? [])];
  },

  async isConnected(userId) {
    return users.has(userId);
  },

  async presenceOfFriends(userId) {
    const user = users.get(userId);
    if (!user) return [];
    const entries: PresenceEntry[] = [];
    for (const friendId of user.friends) {
      const amigo = users.get(friendId);
      if (amigo) entries.push(toPresenceEntry(friendId, amigo));
    }
    return entries;
  },

  async socketIdsOf(userId) {
    return [...(users.get(userId)?.sockets ?? [])];
  },

  async stats() {
    return {
      sockets: sockets.size,
      users: users.size,
      servers: serverMembers.size,
      inVoice: voice.size,
    };
  },

  async voiceParticipant(userId) {
    const entry = voice.get(userId);
    return entry ? toParticipant(userId, entry) : null;
  },

  async joinVoice(params) {
    const previous = voice.get(params.userId);
    const previousServerId =
      previous && previous.serverId !== params.serverId
        ? previous.serverId
        : null;
    if (previous) unindex(params.userId, previous.serverId);

    voice.set(params.userId, {
      socketId: params.socketId,
      serverId: params.serverId,
      channelId: params.channelId,
      selfMuted: previous?.selfMuted ?? false,
      selfDeafened: previous?.selfDeafened ?? false,
      speaking: false,
      streaming: false,
      camera: false,
      serverMuted: previous?.serverMuted ?? false,
      serverDeafened: previous?.serverDeafened ?? false,
      joinedAt:
        previous && previous.channelId === params.channelId
          ? previous.joinedAt
          : Date.now(),
      user: params.user,
    });

    const set = voiceByServer.get(params.serverId) ?? new Set<string>();
    set.add(params.userId);
    voiceByServer.set(params.serverId, set);

    return { previousServerId };
  },

  async leaveVoice(userId, onlyIfSocket) {
    const entry = voice.get(userId);
    if (!entry) return null;
    if (onlyIfSocket && entry.socketId !== onlyIfSocket) return null;

    voice.delete(userId);
    unindex(userId, entry.serverId);
    return {
      serverId: entry.serverId,
      channelId: entry.channelId,
      user: entry.user,
    };
  },

  async setVoiceFlags(userId, patch) {
    const entry = voice.get(userId);
    if (!entry) return null;

    if (typeof patch.selfMuted === "boolean") entry.selfMuted = patch.selfMuted;
    if (typeof patch.selfDeafened === "boolean") {
      entry.selfDeafened = patch.selfDeafened;
      if (patch.selfDeafened) entry.selfMuted = true;
    }

    return {
      serverId: entry.serverId,
      participant: toParticipant(userId, entry),
    };
  },

  async voiceOfServer(serverId) {
    const set = voiceByServer.get(serverId);
    if (!set) return [];
    const list: VoiceParticipant[] = [];
    for (const userId of set) {
      const entry = voice.get(userId);
      if (entry) list.push(toParticipant(userId, entry));
    }
    return list;
  },

  async countInChannel(channelId) {
    let total = 0;
    for (const entry of voice.values()) {
      if (entry.channelId === channelId) total += 1;
    }
    return total;
  },

  async setVoiceSpeaking(userId, speaking) {
    const entry = voice.get(userId);
    if (!entry) return null;
    if (entry.speaking === speaking) return null;
    entry.speaking = speaking;
    return {
      serverId: entry.serverId,
      participant: toParticipant(userId, entry),
    };
  },

  async setVoiceCamera(userId, camera) {
    const entry = voice.get(userId);
    if (!entry) return null;
    if (entry.camera === camera) return null;
    entry.camera = camera;
    return {
      serverId: entry.serverId,
      participant: toParticipant(userId, entry),
    };
  },

  async setVoiceStreaming(userId, streaming) {
    const entry = voice.get(userId);
    if (!entry) return null;
    if (entry.streaming === streaming) return null;
    entry.streaming = streaming;
    return {
      serverId: entry.serverId,
      participant: toParticipant(userId, entry),
    };
  },

  async setVoiceUser(userId, user) {
    const entry = voice.get(userId);
    if (!entry) return null;
    entry.user = user;
    return {
      serverId: entry.serverId,
      participant: toParticipant(userId, entry),
    };
  },

  async countStreaming(channelId) {
    let total = 0;
    for (const entry of voice.values()) {
      if (entry.channelId === channelId && entry.streaming) total += 1;
    }
    return total;
  },

  async voiceLocation(userId) {
    const entry = voice.get(userId);
    return entry
      ? { serverId: entry.serverId, channelId: entry.channelId }
      : null;
  },

  async setServerVoiceFlags(userId, patch) {
    const entry = voice.get(userId);
    if (!entry) return null;

    const before = { muted: entry.serverMuted, deafened: entry.serverDeafened };

    // Independentes de proposito — ver o comentario equivalente em
    // `state-redis.ts::setServerVoiceFlags`.
    if (typeof patch.serverMuted === "boolean")
      entry.serverMuted = patch.serverMuted;
    if (typeof patch.serverDeafened === "boolean")
      entry.serverDeafened = patch.serverDeafened;

    if (
      before.muted === entry.serverMuted &&
      before.deafened === entry.serverDeafened
    ) {
      return null;
    }

    return {
      serverId: entry.serverId,
      channelId: entry.channelId,
      participant: toParticipant(userId, entry),
    };
  },

  async voiceSocketOf(userId) {
    return voice.get(userId)?.socketId ?? null;
  },
};
