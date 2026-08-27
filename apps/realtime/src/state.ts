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
  /** jogo detectado pelo app de desktop; `null` quando nao ha ou esta desligado */
  game: string | null;
  /** desde quando neste jogo — carimbado AQUI, nao pelo cliente */
  gameSince: number | null;
  /** icone do jogo (data URL), ja validado por quem recebeu do cliente */
  gameIcon: string | null;
  /** capa do jogo (URL do IGDB), resolvida pelo servidor; `null` ate chegar */
  gameCover: string | null;
  /** sockets vivos deste usuario */
  sockets: Set<string>;
  /**
   * Ids dos amigos aceitos, carregados do banco ao conectar.
   *
   * Fica em memoria porque a presenca muda muito mais do que a lista de
   * amigos: consultar o banco a cada "fulano ficou ausente" seria uma query
   * por evento. Quando a lista muda de verdade, o app web avisa por
   * `/internal/friends-changed` e ela e recarregada — ver `internal.ts`.
   */
  friends: Set<string>;
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
    game: null,
    gameSince: null,
    gameIcon: null,
    gameCover: null,
    sockets: new Set([socketId]),
    friends: new Set(),
    servers: new Map(),
  });
}

export function statusOf(userId: string): UserStatus {
  return users.get(userId)?.status ?? "OFFLINE";
}

/** Uma entrada de presenca no formato que o cliente consome. */
function toPresenceEntry(userId: string, user: UserPresence): PresenceEntry {
  return {
    userId,
    status: user.status,
    game: user.game,
    gameSince: user.gameSince ? new Date(user.gameSince).toISOString() : null,
    gameIcon: user.gameIcon,
    gameCover: user.gameCover,
  };
}

/**
 * Registra o jogo que a pessoa esta jogando. Devolve os servidores a avisar,
 * ou `null` quando nada mudou — repetir o mesmo nome para a sala inteira a
 * cada verificacao seria trafego sem informacao nova.
 *
 * O carimbo de tempo e daqui, nao do cliente: o mesmo motivo do `joinedAt` da
 * voz. Trocar de jogo reinicia a contagem; continuar no mesmo preserva.
 */
export function setGame(
  userId: string,
  game: string | null,
  icon: string | null = null,
): { servers: string[]; entry: PresenceEntry; nomeMudou: boolean } | null {
  const user = users.get(userId);
  if (!user) return null;

  const nomeMudou = user.game !== game;
  /**
   * O ICONE tambem conta como mudanca, e nao so o nome.
   *
   * Comparar so o nome parecia certo — "o icone acompanha o jogo" — e
   * desfazia, aqui na ponta, um conserto feito do outro lado. O vigia do
   * desktop reanuncia DE PROPOSITO quando o icone melhora: jogo com
   * anti-cheat sobe em etapas, existe uma janela em que o unico processo da
   * pasta e o do anti-cheat, e o icone daquele instante e pior (era o escudo
   * do EAC no Fall Guys). Ele manda o mesmo nome com o icone bom, e o gateway
   * jogava fora por ser "o mesmo jogo".
   *
   * Medido antes do conserto: anunciar o mesmo jogo trocando so o icone
   * gerava ZERO eventos para os outros.
   *
   * Isto nao cria trafego novo: o desktop so reanuncia quando algo mudou de
   * verdade, entao repetir o mesmo par nome+icone continua sendo silencio.
   */
  const iconeMudou = game !== null && user.gameIcon !== icon;
  if (!nomeMudou && !iconeMudou) return null;

  user.game = game;
  user.gameIcon = game ? icon : null;

  /**
   * Carimbo e capa so se mexem quando o JOGO muda.
   *
   * Se apenas o icone melhorou, a pessoa continua na mesma sessao: reiniciar
   * `gameSince` zeraria o tempo de jogo na tela dos outros, e limpar a capa
   * faria a arte ja resolvida piscar e ser buscada de novo.
   */
  if (nomeMudou) {
    user.gameSince = game ? Date.now() : null;
    // A capa do jogo ANTERIOR morre aqui. Ela e resolvida em segundo plano e
    // chega depois; sem zerar, o jogo novo apareceria por um instante com a
    // arte do que acabou de ser fechado.
    user.gameCover = null;
  }

  return {
    servers: [...user.servers.keys()],
    entry: toPresenceEntry(userId, user),
    nomeMudou,
  };
}

/**
 * Anexa a capa resolvida pelo IGDB.
 *
 * `jogoEsperado` existe por causa de uma corrida real: a resolucao acontece em
 * segundo plano e pode demorar segundos. Se a pessoa fechar um jogo e abrir
 * outro nesse intervalo, a resposta atrasada chegaria e grudaria a capa do
 * jogo ANTIGO no novo. Conferimos que ainda e o mesmo jogo antes de aplicar.
 *
 * Devolve a entrada atualizada e os servidores a avisar, ou `null` quando nao
 * ha o que fazer — o que inclui a capa vir vazia, para nao reemitir presenca
 * identica para a sala inteira.
 */
export function setGameCover(
  userId: string,
  jogoEsperado: string,
  cover: string | null,
  displayName?: string,
): { servers: string[]; entry: PresenceEntry } | null {
  const user = users.get(userId);
  if (!user) return null;
  if (user.game !== jogoEsperado) return null;

  const nomeNovo = displayName && displayName !== user.game ? displayName : null;
  if (!cover && !nomeNovo) return null;
  if (cover === user.gameCover && !nomeNovo) return null;

  if (cover) user.gameCover = cover;
  if (nomeNovo) user.game = nomeNovo;

  return {
    servers: [...user.servers.keys()],
    entry: toPresenceEntry(userId, user),
  };
}

/** A presenca de um usuario, para reemitir sem recalcular. */
export function presenceEntryOf(userId: string): PresenceEntry | null {
  const user = users.get(userId);
  return user ? toPresenceEntry(userId, user) : null;
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
    if (user) entries.push(toPresenceEntry(userId, user));
  }
  return entries;
}

/**
 * Guarda a lista de amigos de quem acabou de conectar (ou de quem teve a lista
 * alterada). Silenciosamente ignorada se o usuario ja desconectou — a consulta
 * ao banco e assincrona e pode terminar depois da queda do socket.
 */
export function setFriends(userId: string, friendIds: string[]): void {
  const user = users.get(userId);
  if (!user) return;
  user.friends = new Set(friendIds);
}

/** Amigos conhecidos deste usuario. Vazio quando ele nao esta conectado. */
export function friendsOf(userId: string): string[] {
  return [...(users.get(userId)?.friends ?? [])];
}

/** O usuario tem algum socket vivo? */
export function isConnected(userId: string): boolean {
  return users.has(userId);
}

/**
 * Presenca dos amigos que estao online AGORA.
 *
 * Quem esta offline simplesmente nao aparece na lista — e o mesmo contrato do
 * `presenceOf`, e evita mandar uma entrada "OFFLINE" para cada amigo que nunca
 * conectou hoje.
 */
export function presenceOfFriends(userId: string): PresenceEntry[] {
  const user = users.get(userId);
  if (!user) return [];
  const entries: PresenceEntry[] = [];
  for (const friendId of user.friends) {
    const amigo = users.get(friendId);
    if (amigo) entries.push(toPresenceEntry(friendId, amigo));
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
  streaming: boolean;
  /** camera ligada — sinalizacao; o video vai pelo SFU */
  camera: boolean;
  /** silenciado por moderacao — o proprio usuario nao desfaz */
  serverMuted: boolean;
  serverDeafened: boolean;
  /** quando entrou NESTE canal — a fonte do "ha quanto tempo" na tela */
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
    // Mutado nunca aparece falando, mesmo que o cliente insista — inclusive
    // quando o mudo veio da moderacao.
    speaking: entry.speaking && !entry.selfMuted && !entry.serverMuted,
    joinedAt: new Date(entry.joinedAt).toISOString(),
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
    camera: false,
    speaking: false,
    joinedAt: null,
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
    // Trocar de canal encerra a transmissao: a track fica na sala anterior.
    streaming: false,
    /**
     * A camera tambem NAO acompanha a troca de canal. A faixa pertence a sala
     * anterior; deixar o indicador aceso mostraria camera onde nao ha video.
     */
    camera: false,
    /**
     * Moderacao acompanha a pessoa ao trocar de canal. Zerar aqui deixaria
     * qualquer silenciado se livrar do mudo so entrando em outro canal.
     */
    serverMuted: previous?.serverMuted ?? false,
    serverDeafened: previous?.serverDeafened ?? false,
    /**
     * Trocar de canal REINICIA a contagem; continuar no mesmo canal preserva.
     *
     * A distincao importa na reconexao: uma queda de rede chama isto de novo
     * com o mesmo canal, e zerar ali faria o tempo da pessoa voltar para zero
     * por causa de um soluco de conexao que ela nem viu.
     */
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

/**
 * Marca quem esta com a camera ligada. `null` quando nada mudou — repetir o
 * mesmo estado para a sala inteira e trafego sem informacao nova.
 */
export function setVoiceCamera(
  userId: string,
  camera: boolean,
): { serverId: string; participant: VoiceParticipant } | null {
  const entry = voice.get(userId);
  if (!entry) return null;
  if (entry.camera === camera) return null;
  entry.camera = camera;
  return { serverId: entry.serverId, participant: toParticipant(userId, entry) };
}

/** Marca quem esta compartilhando tela. `null` quando nada mudou. */
export function setVoiceStreaming(
  userId: string,
  streaming: boolean,
): { serverId: string; participant: VoiceParticipant } | null {
  const entry = voice.get(userId);
  if (!entry) return null;
  if (entry.streaming === streaming) return null;
  entry.streaming = streaming;
  return { serverId: entry.serverId, participant: toParticipant(userId, entry) };
}

/** Quantas pessoas transmitem no canal — a interface monta o grid com isto. */
export function countStreaming(channelId: string): number {
  let total = 0;
  for (const entry of voice.values()) {
    if (entry.channelId === channelId && entry.streaming) total += 1;
  }
  return total;
}

/** Onde o usuario esta em voz, com o servidor — evita consultar o banco so por isso. */
export function voiceLocation(
  userId: string,
): { serverId: string; channelId: string } | null {
  const entry = voice.get(userId);
  return entry ? { serverId: entry.serverId, channelId: entry.channelId } : null;
}

/** Sockets vivos de um usuario — usado para despeja-lo de um servidor. */
export function socketIdsOf(userId: string): string[] {
  return [...(users.get(userId)?.sockets ?? [])];
}

/**
 * Aplica moderacao de voz. Devolve `null` quando nada mudou.
 *
 * Ensurdecer implica silenciar, pela mesma razao do lado do usuario: quem nao
 * ouve ninguem nao deve seguir transmitindo sem perceber.
 */
export function setServerVoiceFlags(
  userId: string,
  patch: { serverMuted?: boolean; serverDeafened?: boolean },
): { serverId: string; channelId: string; participant: VoiceParticipant } | null {
  const entry = voice.get(userId);
  if (!entry) return null;

  const before = { muted: entry.serverMuted, deafened: entry.serverDeafened };

  if (typeof patch.serverMuted === "boolean") entry.serverMuted = patch.serverMuted;
  if (typeof patch.serverDeafened === "boolean") {
    entry.serverDeafened = patch.serverDeafened;
    if (patch.serverDeafened) entry.serverMuted = true;
  }

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
}

/** Socket que detem a ocupacao de voz — necessario para mover a pessoa. */
export function voiceSocketOf(userId: string): string | null {
  return voice.get(userId)?.socketId ?? null;
}
