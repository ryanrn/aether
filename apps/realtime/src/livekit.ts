import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
  TrackType,
} from "livekit-server-sdk";
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

/**
 * Validade do token de midia.
 *
 * Era 6h, com um comentario dizendo "curto de proposito". Nao era: um token
 * de 6h que vaze — extensao do navegador, devtools aberto numa transmissao de
 * tela, log de cliente — e meio dia de acesso aquela sala de voz com a
 * identidade de quem o gerou. E o token nao carrega so entrada: carrega os
 * grants de publicacao (microfone, tela, camera) que o @aether/access decidiu.
 *
 * Por que 1h e nao 5 minutos, que seria o rigor de manual: o SDK do LiveKit
 * reapresenta ESTE MESMO token ao reconectar, e nosso cliente nao implementa
 * refresh. Com 5 minutos, qualquer oscilacao de rede depois do quinto minuto
 * de call derrubaria a pessoa de vez. 1h corta a janela em seis sem regressao
 * pratica — e a reconexao automatica do LiveKit desiste em ~1 minuto de queda,
 * bem dentro disso.
 *
 * O caminho para descer mais esta anotado nas limitacoes do README: reemitir
 * pelo gateway em `RoomEvent.Disconnected`, ai o TTL pode ser de minutos.
 */
const TOKEN_TTL = "1h";

export interface MediaCredentials {
  url: string;
  token: string;
  /** o que o token permite — a UI usa para nao oferecer o que sera recusado */
  canPublish: boolean;
  canShareScreen: boolean;
  canUseCamera: boolean;
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
  const canUseCamera = has(params.permissions, "CAMERA");

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
  /**
   * A camera entra na lista de FONTES do token, e nao so numa checagem de
   * interface. E o SFU que recusa a faixa de quem nao pode publicar — nao
   * dependemos de a tela se comportar.
   */
  if (canUseCamera) sources.push(TrackSource.CAMERA);

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
    canUseCamera,
  };
}

/**
 * Cliente administrativo do SFU.
 *
 * Criado sob demanda porque LiveKit e opcional: sem chaves configuradas o
 * gateway continua funcionando, so sem midia.
 */
let roomService: RoomServiceClient | null = null;

function service(): RoomServiceClient | null {
  const config = env.livekit;
  if (!config) return null;
  // A API administrativa fala HTTP; a URL de sinalizacao vem como wss://.
  roomService ??= new RoomServiceClient(
    config.url.replace(/^ws/, "http"),
    config.apiKey,
    config.apiSecret,
  );
  return roomService;
}

/**
 * Silencia (ou devolve a voz de) alguem NO PROPRIO SFU.
 *
 * Este e o ponto que faz "silenciado pelo servidor" ser diferente de um icone:
 * a faixa de audio e desligada na infraestrutura, entao um cliente reescrito
 * nao contorna ligando o microfone de volta. O aviso pelo socket serve para a
 * interface acompanhar; a imposicao acontece aqui.
 *
 * Devolve `false` quando nao foi possivel aplicar — quem chama decide se
 * segue mesmo assim.
 */
export async function applyServerMute(params: {
  channelId: string;
  userId: string;
  muted: boolean;
}): Promise<boolean> {
  const client = service();
  if (!client) return false;

  const room = roomName(params.channelId);
  try {
    const participants = await client.listParticipants(room);
    const target = participants.find((p) => p.identity === params.userId);
    if (!target) return false;

    const audioTracks = target.tracks.filter(
      (track) => track.type === TrackType.AUDIO,
    );
    if (audioTracks.length === 0) return false;

    for (const track of audioTracks) {
      await client.mutePublishedTrack(
        room,
        params.userId,
        track.sid,
        params.muted,
      );
    }
    return true;
  } catch (error) {
    console.error("[gateway] falha ao aplicar mudo no SFU:", error);
    return false;
  }
}
