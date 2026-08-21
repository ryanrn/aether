import type { PresenceEntry, UserStatus } from "@aether/shared";

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
  };
}
