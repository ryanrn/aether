import { AccessToken, TrackSource } from "livekit-server-sdk";
import { has, type PermissionBits } from "@aether/shared";
import { env } from "./env";

/**
 * Emissao do token de acesso ao SFU.
 *
 * A ideia central: as permissoes do Aether viram GRANTS CRIPTOGRAFICOS dentro
 * do token. Quem nao tem SPEAK recebe um token que nao permite publicar
 * microfone — e quem impoe isso passa a ser o proprio LiveKit, nao a nossa
 * interface. Um cliente reescrito nao contorna, porque a restricao esta
 * assinada.
 *
 * O token e emitido dentro do voice:join, no mesmo lugar onde a permissao ja
 * foi checada. Sem permissao nao ha ocupacao, e sem ocupacao nao ha token —
 * um caminho so, sem duas checagens para manter em sincronia.
 */

/** Curto de proposito: e reemitido a cada entrada em canal e nunca guardado. */
const TOKEN_TTL = "6h";

export interface MediaCredentials {
  url: string;
  token: string;
  /** o que o token permite — a UI usa para nao oferecer o que sera recusado */
  canPublish: boolean;
  canShareScreen: boolean;
}

export function isMediaEnabled(): boolean {
  return env.livekit !== null;
}

/** Nome da sala. Uma sala por canal de voz. */
export function roomName(channelId: string): string {
  return `channel:${channelId}`;
}

export async function createMediaCredentials(params: {
  channelId: string;
  userId: string;
  displayName: string;
  permissions: PermissionBits;
}): Promise<MediaCredentials | null> {
  const config = env.livekit;
  if (!config) return null;

  const canPublish = has(params.permissions, "SPEAK");
  const canShareScreen = has(params.permissions, "SCREEN_SHARE");

  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: params.userId,
    name: params.displayName,
    ttl: TOKEN_TTL,
  });

  /**
   * `canSubscribe` sempre verdadeiro para quem chegou aqui: ja passou por
   * VIEW_CHANNEL e CONNECT no handler. Publicar e outra conversa — depende de
   * SPEAK, e a lista de fontes fecha a porta para quem nao tem SCREEN_SHARE
   * (o que ja deixa a fase 5 protegida antes de ela existir).
   */
  const sources: TrackSource[] = [];
  if (canPublish) sources.push(TrackSource.MICROPHONE);
  if (canShareScreen) {
    sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  }

  token.addGrant({
    room: roomName(params.channelId),
    roomJoin: true,
    canSubscribe: true,
    canPublish: sources.length > 0,
    canPublishSources: sources,
    // Metadados de participante sao definidos pelo servidor; cliente nao
    // reescreve o proprio nome nem se promove.
    canUpdateOwnMetadata: false,
  });

  return {
    url: config.url,
    token: await token.toJwt(),
    canPublish,
    canShareScreen,
  };
}
