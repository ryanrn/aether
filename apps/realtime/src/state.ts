import type {
  PresenceEntry,
  PublicUser,
  UserStatus,
  VoiceParticipant,
} from "@aether/shared";

/**
 * Estado vivo do gateway — presenca de quem esta conectado agora.
 *
 * Fica em memoria de proposito. Presenca e efemera: gravar cada mudanca no
 * Postgres seria escrita constante para um dado que perde validade assim que o
 * processo cai. O banco guarda a PREFERENCIA de status (o usuario escolheu
 * DND); quem esta de fato online e o socket aberto, e disso o dono e este mapa.
 *
 * Contagem por socket, nao por usuario: a mesma pessoa abre tres abas, e fechar
 * uma nao pode deixa-la offline para os outros. Ela so fica offline quando o
 * ultimo socket dela some.
 *
 * Consequencia de escalar: com mais de uma instancia isso vira estado
 * particionado e precisa do adapter de Redis. Esta anotado no README.
 */

interface UserPresence {
  status: UserStatus;
  /** sockets vivos deste usuario */
  sockets: Set<string>;
  /** servidores onde este usuario esta visivel, com quantos sockets em cada um */
  servers: Map<string, number>;
}

const users = new Map<string, UserPresence>();
/** indice inverso: de socket para o que ele ocupa, para limpar no disconnect */
const sockets = new Map<string, { userId: string; servers: Set<string> }>();
/** quem esta presente em cada servidor */
const serverMembers = new Map<string, Set<string>>();

export function attachSocket(
  socketId: string,
  userId: string,
  initialStatus: UserStatus,
): void {
  sockets.set(socketId, { userId, servers: new Set() });

  const existing = users.get(userId);
  if (existing) {
    existing.sockets.add(socketId);
    return;
  }
  users.set(userId, {
    // OFFLINE no banco significa "nunca escolheu": conectar equivale a ONLINE.
    status: initialStatus === "OFFLINE" ? "ONLINE" : initialStatus,
    sockets: new Set([socketId]),
    servers: new Map(),
  });
}

export function statusOf(userId: string): UserStatus {
  return users.get(userId)?.status ?? "OFFLINE";
}

/**
 * Registra o socket num servidor.
 * Retorna `true` apenas quando o usuario passou a estar presente ali agora —
 * so nesse caso vale notificar os outros, senao a segunda aba geraria um
 * "ficou online" duplicado.
 */
export function joinServer(socketId: string, serverId: string): boolean {
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
}

/**
 * Tira o socket do servidor.
 * Retorna `true` apenas quando foi o ultimo socket do usuario naquele servidor.
 */
export function leaveServer(socketId: string, serverId: string): boolean {
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
}

/** Limpa tudo que o socket ocupava. Devolve os servidores onde o usuario saiu de fato. */
export function detachSocket(socketId: string): {
  userId: string | null;
  vacatedServers: string[];
} {
  const socket = sockets.get(socketId);
  if (!socket) return { userId: null, vacatedServers: [] };

  const vacated: string[] = [];
  for (const serverId of [...socket.servers]) {
    if (leaveServer(socketId, serverId)) vacated.push(serverId);
  }

  const user = users.get(socket.userId);
  if (user) {
    user.sockets.delete(socketId);
    if (user.sockets.size === 0) users.delete(socket.userId);
  }
  sockets.delete(socketId);

  return { userId: socket.userId, vacatedServers: vacated };
}

/** Troca o status do usuario. Devolve os servidores que precisam ser avisados. */
export function setStatus(userId: string, status: UserStatus): string[] {
  const user = users.get(userId);
  if (!user) return [];
  user.status = status;
  return [...user.servers.keys()];
}

/** Presenca completa de um servidor — o que o cliente recebe ao entrar. */
export function presenceOf(serverId: string): PresenceEntry[] {
  const members = serverMembers.get(serverId);
  if (!members) return [];
  const entries: PresenceEntry[] = [];
  for (const userId of members) {
    const user = users.get(userId);
    if (user) entries.push({ userId, status: user.status });
  }
  return entries;
}

/** Numeros para o /health — util para saber se o processo esta vazando estado. */
export function stats() {
  return {
    sockets: sockets.size,
    users: users.size,
    servers: serverMembers.size,
    inVoice: voice.size,
  };
}

/* -------------------------------------------------------------------------
 * Estado de voz
 *
 * Quem esta em qual canal de voz e conhecimento do gateway, nao do banco:
 * ninguem "esta numa call" de forma persistente. Uma pessoa ocupa no maximo
 * um canal por vez — entrar em outro move, como no Discord/TeamSpeak.
 *
 * Guardamos o socket dono da ocupacao: se a pessoa tem tres abas e a aba que
 * entrou na voz cai, ela sai da voz mesmo que as outras sigam conectadas.
 * ------------------------------------------------------------------------- */

interface VoiceEntry {
  socketId: string;
  serverId: string;
  channelId: string;
  selfMuted: boolean;
  selfDeafened: boolean;
  speaking: boolean;
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
    // moderacao entra na fase 6; transmissao na fase 5; "falando" na fase 4
    serverMuted: false,
    serverDeafened: false,
    streaming: false,
    // Mutado nunca aparece falando, mesmo que o cliente insista.
    speaking: entry.speaking && !entry.selfMuted,
    user: entry.user,
  };
}

/** Participante ja formatado, ou `null` se o usuario nao esta em voz. */
export function voiceParticipant(userId: string): VoiceParticipant | null {
  const entry = voice.get(userId);
  return entry ? toParticipant(userId, entry) : null;
}

/** Forma de "saiu da voz" — channelId nulo, que e como o cliente remove. */
export function voiceDeparture(
  userId: string,
  user: PublicUser,
): VoiceParticipant {
  return {
    userId,
    channelId: null,
    selfMuted: false,
    selfDeafened: false,
    serverMuted: false,
    serverDeafened: false,
    streaming: false,
    speaking: false,
    user,
  };
}

function unindex(userId: string, serverId: string): void {
  const set = voiceByServer.get(serverId);
  if (!set) return;
  set.delete(userId);
  if (set.size === 0) voiceByServer.delete(serverId);
}

/**
 * Coloca o usuario num canal de voz.
 * Devolve o servidor de onde ele saiu, quando a entrada moveu a pessoa de um
 * canal para outro — quem chama precisa avisar os dois lados.
 */
export function joinVoice(params: {
  socketId: string;
  userId: string;
  user: PublicUser;
  serverId: string;
  channelId: string;
}): { previousServerId: string | null } {
  const previous = voice.get(params.userId);
  const previousServerId =
    previous && previous.serverId !== params.serverId ? previous.serverId : null;
  if (previous) unindex(params.userId, previous.serverId);

  voice.set(params.userId, {
    socketId: params.socketId,
    serverId: params.serverId,
    channelId: params.channelId,
    // Trocar de canal preserva mute/surdo: mexer no microfone de alguem sem
    // que ela peca e comportamento surpreendente.
    selfMuted: previous?.selfMuted ?? false,
    selfDeafened: previous?.selfDeafened ?? false,
    speaking: false,
    user: params.user,
  });

  const set = voiceByServer.get(params.serverId) ?? new Set<string>();
  set.add(params.userId);
  voiceByServer.set(params.serverId, set);

  return { previousServerId };
}

/** Tira o usuario da voz. Devolve o que ele ocupava, para avisar quem viu. */
export function leaveVoice(
  userId: string,
  onlyIfSocket?: string,
): { serverId: string; channelId: string; user: PublicUser } | null {
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
}

/** Atualiza microfone/audio proprio. Devolve o estado novo, ou null. */
export function setVoiceFlags(
  userId: string,
  patch: { selfMuted?: boolean; selfDeafened?: boolean },
): { serverId: string; participant: VoiceParticipant } | null {
  const entry = voice.get(userId);
  if (!entry) return null;

  if (typeof patch.selfMuted === "boolean") entry.selfMuted = patch.selfMuted;
  if (typeof patch.selfDeafened === "boolean") {
    entry.selfDeafened = patch.selfDeafened;
    // Ensurdecer implica mutar, como no TeamSpeak: quem nao ouve ninguem nao
    // deve seguir transmitindo sem perceber.
    if (patch.selfDeafened) entry.selfMuted = true;
  }

  return { serverId: entry.serverId, participant: toParticipant(userId, entry) };
}

/** Todos os participantes de voz de um servidor. */
export function voiceOfServer(serverId: string): VoiceParticipant[] {
  const set = voiceByServer.get(serverId);
  if (!set) return [];
  const list: VoiceParticipant[] = [];
  for (const userId of set) {
    const entry = voice.get(userId);
    if (entry) list.push(toParticipant(userId, entry));
  }
  return list;
}

/** Quantas pessoas ocupam o canal — usado para respeitar o limite do canal. */
export function countInChannel(channelId: string): number {
  let total = 0;
  for (const entry of voice.values()) {
    if (entry.channelId === channelId) total += 1;
  }
  return total;
}

/**
 * Marca quem esta falando. Devolve `null` quando nada mudou — assim o gateway
 * nao republica um estado identico para a sala inteira.
 */
export function setVoiceSpeaking(
  userId: string,
  speaking: boolean,
): { serverId: string; participant: VoiceParticipant } | null {
  const entry = voice.get(userId);
  if (!entry) return null;
  if (entry.speaking === speaking) return null;
  entry.speaking = speaking;
  return { serverId: entry.serverId, participant: toParticipant(userId, entry) };
}
