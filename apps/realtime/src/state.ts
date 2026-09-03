import type { PublicUser, VoiceParticipant } from "@aether/shared";
import { redisClients } from "./redis-client";
import { memoryStore } from "./state-memory";
import { createRedisStore } from "./state-redis";
import type { StateStore } from "./state-store";

/**
 * Estado vivo do gateway — presenca de quem esta conectado agora, e quem
 * esta em qual canal de voz.
 *
 * Ate a fase 7c-2 isto era so `state-memory.ts`: um `Map`, uma instancia so.
 * Com `REDIS_URL` configurada, o estado vira compartilhado
 * (`state-redis.ts`) e uma segunda maquina de gateway passa a enxergar quem
 * esta conectado na primeira. Sem a variavel, o comportamento e IDENTICO ao
 * de sempre — nada aqui muda para quem nao provisionou Redis.
 *
 * Cada funcao exportada so repassa para a implementacao escolhida uma vez,
 * na inicializacao do processo — o resto do gateway continua chamando
 * `import { attachSocket, ... } from "./state"` exatamente como sempre
 * chamou, so que agora com `await`.
 */
const store: StateStore = redisClients
  ? createRedisStore(redisClients.main)
  : memoryStore;

export const attachSocket: StateStore["attachSocket"] = (...args) =>
  store.attachSocket(...args);
export const statusOf: StateStore["statusOf"] = (...args) =>
  store.statusOf(...args);
export const setGame: StateStore["setGame"] = (...args) =>
  store.setGame(...args);
export const setGameCover: StateStore["setGameCover"] = (...args) =>
  store.setGameCover(...args);
export const setListening: StateStore["setListening"] = (...args) =>
  store.setListening(...args);
export const presenceEntryOf: StateStore["presenceEntryOf"] = (...args) =>
  store.presenceEntryOf(...args);
export const joinServer: StateStore["joinServer"] = (...args) =>
  store.joinServer(...args);
export const leaveServer: StateStore["leaveServer"] = (...args) =>
  store.leaveServer(...args);
export const detachSocket: StateStore["detachSocket"] = (...args) =>
  store.detachSocket(...args);
export const setStatus: StateStore["setStatus"] = (...args) =>
  store.setStatus(...args);
export const presenceOf: StateStore["presenceOf"] = (...args) =>
  store.presenceOf(...args);
export const setFriends: StateStore["setFriends"] = (...args) =>
  store.setFriends(...args);
export const friendsOf: StateStore["friendsOf"] = (...args) =>
  store.friendsOf(...args);
export const isConnected: StateStore["isConnected"] = (...args) =>
  store.isConnected(...args);
export const presenceOfFriends: StateStore["presenceOfFriends"] = (...args) =>
  store.presenceOfFriends(...args);
export const socketIdsOf: StateStore["socketIdsOf"] = (...args) =>
  store.socketIdsOf(...args);
/** Numeros para o /health — util para saber se o processo esta vazando estado. */
export const stats: StateStore["stats"] = () => store.stats();

export const voiceParticipant: StateStore["voiceParticipant"] = (...args) =>
  store.voiceParticipant(...args);
export const joinVoice: StateStore["joinVoice"] = (...args) =>
  store.joinVoice(...args);
export const leaveVoice: StateStore["leaveVoice"] = (...args) =>
  store.leaveVoice(...args);
export const setVoiceFlags: StateStore["setVoiceFlags"] = (...args) =>
  store.setVoiceFlags(...args);
export const voiceOfServer: StateStore["voiceOfServer"] = (...args) =>
  store.voiceOfServer(...args);
export const countInChannel: StateStore["countInChannel"] = (...args) =>
  store.countInChannel(...args);
export const setVoiceSpeaking: StateStore["setVoiceSpeaking"] = (...args) =>
  store.setVoiceSpeaking(...args);
export const setVoiceCamera: StateStore["setVoiceCamera"] = (...args) =>
  store.setVoiceCamera(...args);
export const setVoiceStreaming: StateStore["setVoiceStreaming"] = (...args) =>
  store.setVoiceStreaming(...args);
export const setVoiceUser: StateStore["setVoiceUser"] = (...args) =>
  store.setVoiceUser(...args);
export const countStreaming: StateStore["countStreaming"] = (...args) =>
  store.countStreaming(...args);
export const voiceLocation: StateStore["voiceLocation"] = (...args) =>
  store.voiceLocation(...args);
export const setServerVoiceFlags: StateStore["setServerVoiceFlags"] = (
  ...args
) => store.setServerVoiceFlags(...args);
export const voiceSocketOf: StateStore["voiceSocketOf"] = (...args) =>
  store.voiceSocketOf(...args);

/**
 * Forma de "saiu da voz" — channelId nulo, que e como o cliente remove.
 *
 * PURA de proposito: nao le nem escreve estado nenhum, entao nao pertence a
 * `StateStore` — as duas implementacoes usariam o mesmo corpo, e exportar
 * daqui evita a pergunta "de qual backend isto vem".
 */
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
