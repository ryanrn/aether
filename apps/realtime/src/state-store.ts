import type {
  PresenceEntry,
  PublicUser,
  UserStatus,
  VoiceParticipant,
} from "@aether/shared";

/**
 * Contrato do estado vivo do gateway — presenca e voz.
 *
 * Duas implementacoes: `state-memory.ts` (os `Map` de sempre, uma instancia
 * so) e `state-redis.ts` (fase 7c-2, varias instancias). `state.ts` escolhe
 * uma das duas na inicializacao, conforme `REDIS_URL` estar configurada, e
 * reexporta funcoes soltas — o resto do gateway chama `import { x } from
 * "./state"` exatamente como sempre chamou. Esta interface existe so para o
 * TypeScript garantir que as duas implementacoes nunca divirjam de forma.
 *
 * TUDO ASSINCRONO, mesmo na implementacao em memoria: uma interface so serve
 * as duas se as duas tiverem a mesma forma, e a versao em Redis precisa ser
 * assincrona de verdade. O custo de um `await` sobre uma funcao que ja
 * terminou e desprezivel.
 */
export interface StateStore {
  attachSocket(
    socketId: string,
    userId: string,
    initialStatus: UserStatus,
  ): Promise<void>;
  statusOf(userId: string): Promise<UserStatus>;
  setGame(
    userId: string,
    game: string | null,
    icon?: string | null,
  ): Promise<{ servers: string[]; entry: PresenceEntry; nomeMudou: boolean } | null>;
  setGameCover(
    userId: string,
    jogoEsperado: string,
    cover: string | null,
    displayName?: string,
  ): Promise<{ servers: string[]; entry: PresenceEntry } | null>;
  presenceEntryOf(userId: string): Promise<PresenceEntry | null>;
  joinServer(socketId: string, serverId: string): Promise<boolean>;
  leaveServer(socketId: string, serverId: string): Promise<boolean>;
  detachSocket(
    socketId: string,
  ): Promise<{ userId: string | null; vacatedServers: string[] }>;
  setStatus(userId: string, status: UserStatus): Promise<string[]>;
  presenceOf(serverId: string): Promise<PresenceEntry[]>;
  setFriends(userId: string, friendIds: string[]): Promise<void>;
  friendsOf(userId: string): Promise<string[]>;
  isConnected(userId: string): Promise<boolean>;
  presenceOfFriends(userId: string): Promise<PresenceEntry[]>;
  socketIdsOf(userId: string): Promise<string[]>;
  stats(): Promise<{
    sockets: number;
    users: number;
    servers: number;
    inVoice: number;
  }>;

  voiceParticipant(userId: string): Promise<VoiceParticipant | null>;
  joinVoice(params: {
    socketId: string;
    userId: string;
    user: PublicUser;
    serverId: string;
    channelId: string;
  }): Promise<{ previousServerId: string | null }>;
  leaveVoice(
    userId: string,
    onlyIfSocket?: string,
  ): Promise<{ serverId: string; channelId: string; user: PublicUser } | null>;
  setVoiceFlags(
    userId: string,
    patch: { selfMuted?: boolean; selfDeafened?: boolean },
  ): Promise<{ serverId: string; participant: VoiceParticipant } | null>;
  voiceOfServer(serverId: string): Promise<VoiceParticipant[]>;
  countInChannel(channelId: string): Promise<number>;
  setVoiceSpeaking(
    userId: string,
    speaking: boolean,
  ): Promise<{ serverId: string; participant: VoiceParticipant } | null>;
  setVoiceCamera(
    userId: string,
    camera: boolean,
  ): Promise<{ serverId: string; participant: VoiceParticipant } | null>;
  setVoiceStreaming(
    userId: string,
    streaming: boolean,
  ): Promise<{ serverId: string; participant: VoiceParticipant } | null>;
  countStreaming(channelId: string): Promise<number>;
  voiceLocation(
    userId: string,
  ): Promise<{ serverId: string; channelId: string } | null>;
  setServerVoiceFlags(
    userId: string,
    patch: { serverMuted?: boolean; serverDeafened?: boolean },
  ): Promise<{
    serverId: string;
    channelId: string;
    participant: VoiceParticipant;
  } | null>;
  voiceSocketOf(userId: string): Promise<string | null>;
}
