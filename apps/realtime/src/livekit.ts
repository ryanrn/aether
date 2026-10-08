import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
  TrackType,
} from "livekit-server-sdk";
import { alturaExcedeOPlano, has, type PermissionBits } from "@aether/shared";
import { log } from "@aether/shared/log";
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
 * Por que 1h e nao 5 minutos, que seria o rigor de manual: enquanto a conexao
 * vive, o SDK do LiveKit ja troca o token sozinho (o servidor empurra um
 * `refreshToken` antes do vencimento). O buraco e a rede cair ATRAVESSANDO o
 * vencimento — a reconexao automatica esgota as tentativas com um token morto.
 *
 * Isso agora tem rede de seguranca: `RoomEvent.Disconnected` na `room.ts` pede
 * `voice:refresh-token` ao gateway e reconecta. Com ela no ar, baixar o TTL
 * virou mudanca sem regressao — fica como follow-up.
 */
const TOKEN_TTL_SECONDS = 60 * 60;

export interface MediaCredentials {
  url: string;
  token: string;
  /** o que o token permite — a UI usa para nao oferecer o que sera recusado */
  canPublish: boolean;
  canShareScreen: boolean;
  canUseCamera: boolean;
  /** epoch (ms) do vencimento — o cliente renova antes disso */
  expiresAt: number;
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
    ttl: TOKEN_TTL_SECONDS,
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
    expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000,
  };
}

/** Sala de midia de uma conversa direta. Prefixo proprio: nunca colide com canal. */
export function dmRoomName(dmId: string): string {
  return `dm:${dmId}`;
}

/**
 * Token da chamada de voz de uma conversa direta.
 *
 * Quem chega aqui ja passou por `loadDmAccess` — a mesma porta das mensagens.
 * Nao ha cargo nem bitfield numa conversa, entao o que o token permite e fixo:
 * microfone, tela (com o som dela) e camera. Os dois ja podem se falar, e e o
 * mesmo par de pessoas — nao ha um "cargo sem SCREEN_SHARE" a respeitar.
 *
 * O que continua imposto e o TETO DO PLANO na tela: `dmcall:tela` faz o
 * gateway conferir a resolucao publicada e silenciar no SFU o que passar,
 * exatamente como na voz de servidor.
 */
export async function createDmCallCredentials(params: {
  dmId: string;
  userId: string;
  displayName: string;
}): Promise<MediaCredentials | null> {
  const config = env.livekit;
  if (!config) return null;

  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: params.userId,
    name: params.displayName,
    ttl: TOKEN_TTL_SECONDS,
  });
  token.addGrant({
    room: dmRoomName(params.dmId),
    roomJoin: true,
    canSubscribe: true,
    canPublish: true,
    canPublishSources: [
      TrackSource.MICROPHONE,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
      TrackSource.CAMERA,
    ],
    canUpdateOwnMetadata: false,
  });

  return {
    url: config.url,
    token: await token.toJwt(),
    canPublish: true,
    canShareScreen: true,
    canUseCamera: true,
    expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000,
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
 * O que aconteceu ao tentar impor mudo/voz no SFU.
 *
 *  - `aplicado`: o SFU confirmou a mudanca na faixa de audio.
 *  - `sem_faixa`: a pessoa nao tem faixa de audio publicada agora (sem SPEAK,
 *    ou so entrou) — nao e falha, so nao ha o que mutar ainda.
 *  - `fora_da_sala`: o SFU respondeu, e a pessoa NAO esta conectada a sala de
 *    midia (ainda conectando, ou ocupa o canal sem audio). Nada esta sendo
 *    transmitido, entao nao ha o que vazar — mesmo caso de `sem_faixa`. O
 *    cliente honesto ja entra mudo (`deveEstarMutado` le `serverMuted`).
 *  - `falhou`: SFU fora do ar ou erro de rede — a diferenca para os dois de
 *    cima importa porque SO ISTO deveria virar erro pro moderador.
 *
 * `fora_da_sala` ja foi `falhou`, e isso fazia silenciar quem ainda nao tinha
 * conectado ao SFU responder "o servidor de audio nao confirmou" com o SFU
 * perfeitamente no ar (o LiveKit lista sala inexistente como vazia, sem erro).
 * Era o que derrubava o `verify-phase6` no CI desde a correcao de auditoria.
 */
export type ResultadoDeMudoNoSfu =
  | "aplicado"
  | "sem_faixa"
  | "fora_da_sala"
  | "falhou";

/**
 * Silencia (ou devolve a voz de) alguem NO PROPRIO SFU.
 *
 * Este e o ponto que faz "silenciado pelo servidor" ser diferente de um icone:
 * a faixa de audio e desligada na infraestrutura, entao um cliente reescrito
 * nao contorna ligando o microfone de volta. O aviso pelo socket serve para a
 * interface acompanhar; a imposicao acontece aqui.
 *
 * Devolve o RESULTADO em vez de um booleano — `false` sozinho nao deixava
 * quem chama distinguir "sem faixa ainda" (normal) de "o SFU nao confirmou"
 * (a moderacao pode ter falhado de verdade). Ver `handlers/voice.ts::
 * voice:moderate`, que usa essa distincao pra so avisar o moderador quando
 * for `falhou`.
 */
export async function applyServerMute(params: {
  channelId: string;
  userId: string;
  muted: boolean;
}): Promise<ResultadoDeMudoNoSfu> {
  const client = service();
  if (!client) return "falhou";

  const room = roomName(params.channelId);
  try {
    const participants = await client.listParticipants(room);
    const target = participants.find((p) => p.identity === params.userId);
    if (!target) return "fora_da_sala";

    const audioTracks = target.tracks.filter(
      (track) => track.type === TrackType.AUDIO,
    );
    if (audioTracks.length === 0) return "sem_faixa";

    for (const track of audioTracks) {
      await client.mutePublishedTrack(
        room,
        params.userId,
        track.sid,
        params.muted,
      );
    }
    return "aplicado";
  } catch (error) {
    log.error("gateway.livekit.mudo", "falha ao aplicar mudo no SFU", { err: error });
    return "falhou";
  }
}

/* -------------------------------------------------------------------------
 * Qualidade da tela por plano
 *
 * POR QUE ISTO PRECISA EXISTIR NO SERVIDOR: a resolucao e escolhida no
 * CLIENTE. O app oferece so os perfis que o plano permite, mas isso e
 * interface — quem editar o `localStorage` ou reescrever o cliente publica em
 * 1440p com plano gratuito. Num recurso pago, gate de interface nao e
 * decoracao inofensiva: e receita que nao entra.
 *
 * O token do SFU nao resolve. Ele governa QUEM publica e de quais fontes;
 * bitrate e resolucao nao cabem num grant. Entao a imposicao e por
 * verificacao: depois que a faixa sobe, perguntamos ao SFU quanto ela tem de
 * verdade e silenciamos a que passou do teto.
 *
 * ISSO TEM UMA JANELA, e ela e honesta de reconhecer: entre publicar e ser
 * checado passam alguns segundos, e nesse intervalo a transmissao acima do
 * plano acontece. Fechar essa janela exigiria o SFU recusar na entrada, o que
 * o LiveKit nao oferece. Alguns segundos de 1440p nao sao o que ameaca o
 * negocio; transmitir o dia inteiro sem pagar, sim.
 * ------------------------------------------------------------------------- */

export interface QualidadeExcedida {
  alturaPublicada: number;
  alturaMax: number;
  silenciada: boolean;
}

/**
 * Confere a tela publicada contra o teto do plano e SILENCIA o que exceder.
 *
 * Devolve `null` quando esta tudo certo, quando nao ha faixa de tela ainda, ou
 * quando o LiveKit nao esta configurado — nos tres casos nao ha o que fazer.
 *
 * A tolerancia existe porque o codificador nem sempre entrega exatamente o
 * pedido: 1080p pode sair como 1082 dependendo do recorte da janela. Barrar
 * por dois pixels seria punir quem esta dentro do plano.
 */
export async function conferirQualidadeDaTela(params: {
  /**
   * Sala do SFU: `roomName(canal)` na voz de servidor, `dmRoomName(conversa)`
   * na chamada direta. Recebe a sala pronta, e nao o canal, para as duas
   * passarem pela MESMA regra de teto — uma copia por tipo de sala divergiria.
   */
  sala: string;
  userId: string;
  alturaMax: number;
}): Promise<QualidadeExcedida | null> {
  const client = service();
  if (!client) return null;

  const room = params.sala;

  try {
    const participants = await client.listParticipants(room);
    const target = participants.find((p) => p.identity === params.userId);
    if (!target) return null;

    /**
     * So a faixa de TELA. A camera tem teto proprio e o microfone nao tem
     * resolucao — filtrar pela fonte evita silenciar a webcam de alguem por
     * causa do plano de compartilhamento.
     */
    const tela = target.tracks.find(
      (track) =>
        track.type === TrackType.VIDEO &&
        track.source === TrackSource.SCREEN_SHARE,
    );
    if (!tela) return null;

    /**
     * A REGRA MORA EM `@aether/shared`, e nao aqui: e a mesma que a interface
     * usa para trancar o perfil. Duas copias discordariam, e a pessoa
     * escolheria algo que a tela oferece e o servidor derruba.
     */
    const altura = tela.height ?? 0;
    if (!alturaExcedeOPlano(altura, params.alturaMax)) {
      /**
       * Dentro do plano agora — se a faixa tinha sido silenciada por excesso
       * antes (`tela.muted`), devolve a voz. Sem isto, baixar a qualidade
       * depois de ser pego nunca restaurava a transmissao: a pessoa tinha
       * que parar e comecar de novo do zero pra reaparecer aos outros.
       */
      if (tela.muted) {
        try {
          await client.mutePublishedTrack(room, params.userId, tela.sid, false);
        } catch (error) {
          log.error(
            "gateway.livekit.desilenciar_tela",
            "nao devolvi a tela apos a qualidade caber no plano",
            { err: error },
          );
        }
      }
      return null;
    }

    let silenciada = false;
    try {
      await client.mutePublishedTrack(room, params.userId, tela.sid, true);
      silenciada = true;
    } catch (error) {
      log.error(
        "gateway.livekit.silenciar_tela",
        "não silenciei a tela acima do plano",
        { err: error },
      );
    }

    return { alturaPublicada: altura, alturaMax: params.alturaMax, silenciada };
  } catch (error) {
    log.error(
      "gateway.livekit.conferir_qualidade",
      "falha ao conferir a qualidade da tela",
      { err: error },
    );
    return null;
  }
}
