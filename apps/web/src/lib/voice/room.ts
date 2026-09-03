"use client";

import {
  createLocalScreenTracks,
  DisconnectReason,
  LocalVideoTrack,
  Room,
  RoomEvent,
  setLogLevel,
  Track,
  type LocalTrackPublication,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from "livekit-client";
import type { MediaGrant } from "@aether/shared";
import {
  isAudioSourceError,
  isDesktopApp,
  reportDesktopAudioFailure,
  saveShareAudioPreference,
  SHARE_PRESETS,
  type SharePresetId,
} from "./screen-share";
import {
  capturarSomDoSistema,
  pediuSomNoSeletor,
  podeCapturarSomDoSistema,
  type SomDoSistema,
} from "./system-audio";
import { mediaDebugEnabled, mediaLog } from "./debug";
import { lerCodecDeTela } from "./codecs";
import { lerTratamentoDeAudio, paraConstraints } from "./audio-prefs";
import { criarFiltroDeRuido } from "./noise-filter";
import {
  readPreferredMicrophone,
  readPreferredSpeaker,
  savePreferredSpeaker,
} from "./devices";
import {
  clampVolume,
  DEFAULT_VOLUME,
  readScreenVolume,
  readUserVolumes,
} from "./volumes";
import { createMicAnalyser } from "./mic-analyser";
import { createSpeechGate } from "./speech-gate";
import { startConnectionStats, type ConnectionStats } from "./connection-stats";

/**
 * Conexao com a sala de midia (SFU).
 *
 * Este modulo NAO decide nada: ele recebe um token que ja carrega, assinado,
 * o que o usuario pode fazer. Se o token nao permite publicar tela, a chamada
 * falha no proprio SFU — nao dependemos de a interface se comportar.
 *
 * O audio remoto e reproduzido por elementos <audio> criados aqui e presos a
 * um container fora da arvore do React: deixar o React montar e desmontar
 * esses elementos causaria cortes no som a cada re-render.
 *
 * O VIDEO segue o caminho oposto — as tracks sao entregues por callback e quem
 * decide onde desenhar e a interface, porque um mesmo compartilhamento aparece
 * em dois lugares ao mesmo tempo (miniatura e destaque).
 */

export interface RemoteScreenShare {
  userId: string;
  displayName: string;
  track: RemoteTrack;
}

/** Camera de outra pessoa, ja inscrita e pronta para desenhar. */
export interface RemoteCamera {
  userId: string;
  track: RemoteTrack;
}

export interface VoiceRoomCallbacks {
  /** o proprio usuario comecou/parou de falar — segue para o nosso gateway */
  onSpeakingChange: (speaking: boolean) => void;
  /**
   * Nivel de audio por participante (0..1), ~11x/s. So para MODULAR o glow de
   * fala — quem decide "esta falando" continua sendo `onSpeakingChange` (proprio)
   * e o gateway (dos outros). Chave = identidade LiveKit = userId.
   *
   * O proprio nivel vem do analisador local (RMS da faixa publicada); o dos
   * outros vem de `RemoteParticipant.audioLevel` do SDK. Se algum vier 0, o
   * card cai na animacao `aether-breathe` — o glow nunca some por causa disto.
   */
  onAudioLevels?: (levels: Record<string, number>) => void;
  onConnectionChange: (connected: boolean) => void;
  /** alguem comecou ou parou de compartilhar tela na sala */
  onScreenSharesChange: (shares: RemoteScreenShare[]) => void;
  /** alguem ligou ou desligou a camera na sala */
  onCamerasChange: (cameras: RemoteCamera[]) => void;
  /**
   * A transmissao local terminou. Inclui o caso de a pessoa clicar em "parar
   * de compartilhar" na barra do proprio navegador, que nao passa pela nossa
   * interface.
   */
  onLocalShareEnded: () => void;
  onError: (message: string) => void;
  /**
   * Pede ao gateway um token de midia novo para a MESMA sala. Chamado quando a
   * conexao com o SFU cai de vez (a reconexao automatica do LiveKit desistiu),
   * tipicamente porque a rede ficou fora atravessando o vencimento do token.
   *
   * Devolve `null` quando o gateway recusa (perdi o acesso ou nao estou mais
   * em canal) ou nao responde — nesse caso a sala para de tentar.
   */
  renovarCredencial: () => Promise<MediaGrant | null>;
}

export interface VoiceRoomHandle {
  setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
  /** troca o microfone ativo sem derrubar a call */
  setMicrophone: (deviceId: string) => Promise<void>;
  /** ensurdecer: para de reproduzir o audio dos outros */
  setDeafened: (deafened: boolean) => void;
  /** volume com que EU ouço o microfone de alguem (0..1) */
  setUserVolume: (userId: string, volume: number) => void;
  /** volume do audio que vem junto dos compartilhamentos de tela (0..1) */
  setScreenAudioVolume: (volume: number) => void;
  /** abre o seletor nativo do navegador e publica. `false` se o usuario cancelou. */
  startScreenShare: (
    preset: SharePresetId,
    withSystemAudio: boolean,
  ) => Promise<boolean>;
  /**
   * Troca a qualidade da transmissao JA no ar, sem reabrir o seletor de tela.
   * `false` quando nao ha transmissao ativa.
   */
  setSharePreset: (preset: SharePresetId) => Promise<boolean>;
  stopScreenShare: () => Promise<void>;
  /** faixa local de tela, para a previa de quem esta transmitindo */
  localScreenTrack: () => Track | null;
  /** liga/desliga a camera; `false` quando nao deu */
  setCameraEnabled: (enabled: boolean, deviceId?: string) => Promise<boolean>;
  /** a propria camera, para voce se ver */
  localCameraTrack: () => Track | null;
  /**
   * Liga/desliga o RNNoise na faixa de microfone JA publicada, sem reabrir o
   * dispositivo. `false` quando nao ha faixa (fora de call, ou mic ainda nao
   * publicado) — o botao no dock fica desabilitado nesse caso, em vez de fingir.
   *
   * Ligar: `setProcessor(criarFiltroDeRuido())`. Desligar: `stopProcessor()`.
   * O SDK reaplica o processador na reconexao sozinho.
   */
  definirSupressaoAvancada: (ligado: boolean) => Promise<boolean>;
  /**
   * Reaplica as constraints NATIVAS do microfone (supressao nativa, eco, ganho)
   * lendo a preferencia atual — `restartTrack` re-adquire a faixa com as novas
   * constraints e a republica, sem derrubar ninguem. `false` se nao houver
   * faixa. Em falha, tenta reabrir o microfone e devolve `false`.
   */
  reaplicarTratamentoNativo: () => Promise<boolean>;
  /** para ONDE tocamos o audio recebido — mic dos outros e som de tela */
  setOutputDevice: (deviceId: string) => Promise<void>;
  /**
   * Assina as estatisticas de conexao (ping, perda, regiao). Nada e medido
   * enquanto ninguem assina — o painel so monta quando aberto. Devolve o
   * cancelador.
   */
  subscribeConnectionStats: (
    cb: (stats: ConnectionStats) => void,
  ) => () => void;
  disconnect: () => Promise<void>;
}

/**
 * Traduz o erro do navegador em algo acionavel.
 *
 * A versao anterior chutava uma causa unica ("outro programa esta usando") e
 * mandava a pessoa mexer no lugar errado — o erro real era
 * `NotAllowedError: Permission denied`, vindo do cabecalho
 * `Permissions-Policy: camera=()`. Cada nome de excecao aponta para um lugar
 * diferente, e dizer a causa errada e pior do que nao dizer nenhuma.
 */
function explicarErroDeCamera(erro: unknown, ligando: boolean): string {
  if (!ligando) return "Nao consegui desligar a camera.";

  const nome = erro instanceof Error ? erro.name : "";
  switch (nome) {
    case "NotAllowedError":
      return (
        "A camera foi bloqueada. Se o aviso do sistema apareceu, escolha " +
        "permitir; se nao apareceu, o bloqueio vem do proprio app e precisa " +
        "de correcao nossa."
      );
    case "NotFoundError":
    case "OverconstrainedError":
      return "Nenhuma camera encontrada. Conecte uma e tente de novo.";
    case "NotReadableError":
      return (
        "A camera existe mas nao abriu — normalmente outro programa esta " +
        "usando. Feche-o e tente de novo."
      );
    default:
      return erro instanceof Error
        ? `Nao consegui ligar a camera (${erro.name}: ${erro.message}).`
        : "Nao consegui ligar a camera.";
  }
}

/** Container dos <audio> remotos, fora do controle do React. */
function audioContainer(): HTMLElement {
  const existing = document.getElementById("aether-audio-sink");
  if (existing) return existing;
  const element = document.createElement("div");
  element.id = "aether-audio-sink";
  /**
   * Escondido SEM display:none. Navegadores podem suspender a reproducao de
   * elementos de midia dentro de subarvores com display:none — o sintoma e
   * exatamente "o audio toca um segundo e para". Fora da tela e com tamanho
   * minimo o elemento continua sendo reproduzido normalmente.
   */
  element.style.cssText =
    "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
  document.body.appendChild(element);
  return element;
}

/**
 * Liga o RNNoise na faixa do microfone, se a pessoa pediu.
 *
 * SEPARADA E ENVOLVIDA EM try: falhar aqui nao pode impedir a entrada na call.
 * O pior caso aceitavel e entrar sem supressao avancada; entrar sem microfone,
 * ou nao entrar, nao e.
 *
 * `setProcessor` e do proprio SDK — ele republica na reconexao e acompanha
 * mudo e troca de aparelho sozinho, coisas que trocar a faixa na mao obrigaria
 * a reimplementar.
 */
async function aplicarFiltroDeRuido(room: Room): Promise<void> {
  if (!lerTratamentoDeAudio().rnnoise) return;
  await alternarFiltroDeRuido(room, true);
}

/**
 * Liga/desliga o RNNoise na faixa de mic publicada. Usada tanto na entrada
 * (via `aplicarFiltroDeRuido`, que respeita a preferencia) quanto pelo botao
 * do dock ao vivo. Devolve `false` quando nao ha faixa para processar.
 */
async function alternarFiltroDeRuido(
  room: Room,
  ligado: boolean,
): Promise<boolean> {
  try {
    const publicacao = room.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    );
    const faixa = publicacao?.audioTrack;
    if (!faixa) return false;

    if (ligado) {
      await faixa.setProcessor(criarFiltroDeRuido());
      mediaLog("filtro de ruido ligado");
    } else {
      await faixa.stopProcessor();
      mediaLog("filtro de ruido desligado");
    }
    return true;
  } catch (erro) {
    // O som cru segue publicado: `setProcessor` so troca a faixa quando o
    // processador devolve uma, e `stopProcessor` volta pra faixa original.
    mediaLog("nao consegui alternar o filtro de ruido", erro);
    return false;
  }
}

export async function connectVoiceRoom({
  url,
  token,
  canPublish,
  callbacks,
}: {
  url: string;
  token: string;
  canPublish: boolean;
  callbacks: VoiceRoomCallbacks;
}): Promise<VoiceRoomHandle> {
  // Com ?debug=media na URL, o proprio SFU passa a relatar o que faz.
  if (mediaDebugEnabled()) setLogLevel("debug");

  const preferredMic = readPreferredMicrophone();

  const room = new Room({
    // Cancelamento de eco e supressao de ruido no proprio navegador: sem isso,
    // caixa de som aberta devolve a voz dos outros para dentro da call.
    audioCaptureDefaults: {
      /**
       * Os tres vinham fixos em `true`. Agora saem da preferencia, que nasce
       * com os tres ligados — o padrao nao mudou, o que mudou e poder
       * desligar. Ver `audio-prefs.ts` para por que isso importa.
       */
      ...paraConstraints(lerTratamentoDeAudio()),
      // Preferencia salva da vez anterior. Se o aparelho nao existir mais, o
      // navegador cai no padrao do sistema em vez de falhar.
      ...(preferredMic ? { deviceId: preferredMic } : {}),
    },
    /**
     * adaptiveStream DESLIGADO de proposito.
     *
     * Ele pausa faixas de video conforme a visibilidade do elemento anexado.
     * Como anexamos por um caminho proprio (o mesmo compartilhamento aparece
     * no destaque e na miniatura), qualquer divergencia na medicao vira
     * "a tela do outro nunca aparece" — sem erro, sem log, so nao aparece.
     *
     * O custo e alguma banda a mais; o beneficio e um modo de falha a menos
     * num recurso que precisa simplesmente funcionar.
     */
    adaptiveStream: false,
    dynacast: true,
  });

  /**
   * A sessao de som do sistema pelo modulo nativo, quando ha uma.
   *
   * Mora no escopo da SALA, e nao dentro do `startScreenShare`, porque quem
   * precisa encerra-la e o `stopScreenShare`, o `disconnect` e o evento de
   * parada pela barra do navegador — tres caminhos diferentes. Sem isto, a
   * thread de captura no processo principal continuaria viva depois de a
   * transmissao acabar, segurando o dispositivo de audio.
   */
  let somNativo: SomDoSistema | null = null;

  async function pararSomNativo(): Promise<void> {
    if (!somNativo) return;
    const sessao = somNativo;
    somNativo = null;
    await room.localParticipant
      .unpublishTrack(sessao.track)
      .catch(() => undefined);
    await sessao.parar();
  }

  const sink = audioContainer();
  /**
   * Elementos de audio por participante, SEPARADOS por origem.
   *
   * Antes era uma lista so: microfone e audio de tela caiam no mesmo balde, e
   * por isso nao havia como mexer num sem mexer no outro. A separacao e o que
   * torna possivel abaixar a musica de quem compartilha sem abaixar a voz
   * dele.
   */
  interface AttachedAudio {
    mic: HTMLMediaElement[];
    screen: HTMLMediaElement[];
  }
  const attachedAudio = new Map<string, AttachedAudio>();
  let deafened = false;
  /** Alto-falante escolhido para tocar o que chega. `null` = padrao do sistema. */
  let preferredSpeaker = readPreferredSpeaker();

  /**
   * `setSinkId` e Chromium-only (o app roda em Chromium e no Electron, que e
   * Chromium por baixo — nao ha suporte no Firefox). Por isso o metodo pode
   * simplesmente nao existir no elemento, e tratamos isso como "sem suporte",
   * nao como erro: a pessoa continua ouvindo pelo padrao do sistema.
   */
  function applySinkId(element: HTMLMediaElement): void {
    if (!preferredSpeaker) return;
    const withSink = element as HTMLMediaElement & {
      setSinkId?: (sinkId: string) => Promise<void>;
    };
    if (typeof withSink.setSinkId !== "function") return;
    void withSink.setSinkId(preferredSpeaker).catch((error: unknown) => {
      mediaLog("nao consegui usar o alto-falante escolhido", error);
    });
  }

  /** Volumes locais, restaurados do que a pessoa deixou na sessao anterior. */
  const userVolumes = new Map<string, number>(
    Object.entries(readUserVolumes()),
  );
  let screenVolume = readScreenVolume();

  function bucketOf(identity: string): AttachedAudio {
    const existing = attachedAudio.get(identity);
    if (existing) return existing;
    const created: AttachedAudio = { mic: [], screen: [] };
    attachedAudio.set(identity, created);
    return created;
  }

  /** Volume efetivo de um elemento: ensurdecido zera tudo. */
  function applyVolume(
    element: HTMLMediaElement,
    identity: string,
    isScreen: boolean,
  ): void {
    element.muted = deafened;
    element.volume = isScreen
      ? screenVolume
      : (userVolumes.get(identity) ?? DEFAULT_VOLUME);
  }

  function reapplyAll(): void {
    for (const [identity, bucket] of attachedAudio) {
      for (const element of bucket.mic) applyVolume(element, identity, false);
      for (const element of bucket.screen) applyVolume(element, identity, true);
    }
  }

  /** Compartilhamentos remotos ativos, por identidade do participante. */
  const screenShares = new Map<string, RemoteScreenShare>();

  function publishScreenShares() {
    callbacks.onScreenSharesChange([...screenShares.values()]);
  }

  /** Cameras remotas ativas, por identidade do participante. */
  const cameras = new Map<string, RemoteCamera>();

  function publishCameras() {
    callbacks.onCamerasChange([...cameras.values()]);
  }

  room.on(
    RoomEvent.TrackSubscribed,
    (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      mediaLog("faixa recebida", {
        de: participant.identity,
        tipo: track.kind,
        origem: publication.source,
      });

      if (track.kind === Track.Kind.Audio) {
        /**
         * Audio de tela vem junto do compartilhamento e toca como qualquer
         * outro audio da sala — nao ha nada a desenhar. Mas guardamos SEPARADO
         * do microfone: sao dois volumes independentes, e no mesmo balde nao
         * daria para abaixar a musica sem abaixar a voz.
         */
        const isScreen = publication.source === Track.Source.ScreenShareAudio;
        const element = track.attach();
        applyVolume(element, participant.identity, isScreen);
        applySinkId(element);
        sink.appendChild(element);
        /**
         * O attach do LiveKit ja tenta tocar, mas o navegador pode recusar
         * silenciosamente. Insistir aqui e barato e transforma "nao sai som"
         * numa mensagem no console em vez de um misterio.
         */
        void element.play().catch((error: unknown) => {
          mediaLog("navegador recusou reproduzir", error);
          callbacks.onError(
            "O navegador bloqueou o audio. Clique na pagina para liberar.",
          );
        });
        const bucket = bucketOf(participant.identity);
        (isScreen ? bucket.screen : bucket.mic).push(element);
        return;
      }

      if (track.kind !== Track.Kind.Video) return;

      /**
       * Agora ha DOIS tipos de video, e eles precisam ir para lugares
       * diferentes: camera vai no bloco da pessoa, tela vai no palco.
       *
       * A regra de desempate importa. Antes deste recurso, qualquer video era
       * tela — e filtrar por `publication.source` tinha se mostrado fragil:
       * quando a origem ainda nao estava resolvida na hora da inscricao, a
       * faixa era descartada em silencio, sem nova chance.
       *
       * Por isso a condicao e afirmativa para a CAMERA e o resto cai em tela.
       * Origem indefinida continua indo para onde ia antes, e nao para o
       * limbo: no pior caso a tela de alguem aparece no palco (o comportamento
       * de sempre), nunca uma faixa some.
       */
      if (publication.source === Track.Source.Camera) {
        mediaLog("camera recebida", participant.identity);
        cameras.set(participant.identity, {
          userId: participant.identity,
          track,
        });
        publishCameras();
        return;
      }

      mediaLog("compartilhamento de tela recebido", participant.identity);
      screenShares.set(participant.identity, {
        userId: participant.identity,
        displayName: participant.name || participant.identity,
        track,
      });
      publishScreenShares();
    },
  );

  room.on(
    RoomEvent.TrackUnsubscribed,
    (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
      for (const element of track.detach()) element.remove();
      if (screenShares.delete(participant.identity)) publishScreenShares();
      if (cameras.delete(participant.identity)) publishCameras();
    },
  );

  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    const bucket = attachedAudio.get(participant.identity);
    for (const element of [...(bucket?.mic ?? []), ...(bucket?.screen ?? [])]) {
      element.remove();
    }
    attachedAudio.delete(participant.identity);
    if (screenShares.delete(participant.identity)) publishScreenShares();
    // Quem saiu leva a camera junto — senao o bloco dele ficaria com um
    // quadro congelado de alguem que nao esta mais na sala.
    if (cameras.delete(participant.identity)) publishCameras();
  });

  /**
   * Deteccao de fala LOCAL, instantanea.
   *
   * O "estou falando" vinha daqui, do `ActiveSpeakersChanged` — que o SFU
   * calcula NO SERVIDOR a cada ~400ms, com histerese, para responder "quem e
   * o falante dominante". Bom para destacar; ruim para acender a bordinha na
   * hora, e falas curtas nem chegavam a contar. Agora a fonte local e o
   * `detectorLocal` abaixo, que analisa a propria faixa publicada NO
   * NAVEGADOR — o mesmo audio que os outros ouvem, sem ida ao servidor.
   *
   * Este evento continua ligado como RESERVA: se o analisador local nao
   * inicializar (Web Audio indisponivel), ele volta a ser a fonte.
   */
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    if (detectorLocal) return;
    const speaking = speakers.some(
      (speaker) => speaker.identity === room.localParticipant.identity,
    );
    callbacks.onSpeakingChange(speaking);
  });

  interface DetectorLocal {
    stop: () => void;
    /** reaponta para a faixa de mic atual (troca de aparelho, republicacao) */
    retarget: () => void;
    setMudo: (mudo: boolean) => void;
  }
  let detectorLocal: DetectorLocal | null = null;
  /** ultimo RMS medido da propria faixa (0..1); alimenta o glow do proprio card */
  let ultimoRmsLocal = 0;
  /** poll que empurra os niveis de audio de todos para o glow */
  let nivelTimer: ReturnType<typeof setInterval> | null = null;
  /** `disconnect()` foi chamado — nao tentar recuperar a conexao */
  let encerrado = false;
  /** ha uma recuperacao de conexao em andamento */
  let recuperando = false;

  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * Motivos de `RoomEvent.Disconnected` em que vale tentar reconectar. Fora
   * desta lista (expulso, sala apagada, identidade duplicada, saida do
   * cliente) reconectar so bateria numa porta fechada.
   */
  const MOTIVOS_RECUPERAVEIS = new Set<DisconnectReason | undefined>([
    undefined,
    DisconnectReason.UNKNOWN_REASON,
    DisconnectReason.SERVER_SHUTDOWN,
    DisconnectReason.STATE_MISMATCH,
    DisconnectReason.JOIN_FAILURE,
    DisconnectReason.SIGNAL_CLOSE,
    DisconnectReason.CONNECTION_TIMEOUT,
    DisconnectReason.MEDIA_FAILURE,
  ]);

  /**
   * A conexao com o SFU caiu de vez (a reconexao automatica do LiveKit ja
   * desistiu). Pede um token novo ao gateway e reconecta — com recuo, ate
   * conseguir ou o gateway recusar.
   */
  async function recuperarConexao(): Promise<void> {
    if (recuperando || encerrado) return;
    recuperando = true;
    const atrasos = [0, 2000, 5000, 10_000, 20_000, 30_000];
    try {
      for (const atraso of atrasos) {
        if (encerrado) return;
        if (atraso) await espera(atraso);
        if (encerrado) return;

        const cred = await callbacks.renovarCredencial();
        if (encerrado) return;
        if (!cred) {
          // Gateway recusou: sem acesso, ou nao estou mais em canal.
          callbacks.onError(
            "A conexao de voz caiu e nao foi possivel restabelecer.",
          );
          return;
        }

        try {
          await room.connect(cred.url, cred.token);
          mediaLog("conexao de voz restabelecida");
          callbacks.onConnectionChange(true);
          if (!room.canPlaybackAudio) {
            await room.startAudio().catch(() => undefined);
          }
          if (canPublish) {
            await room.localParticipant
              .setMicrophoneEnabled(true)
              .catch(() => undefined);
            await aplicarFiltroDeRuido(room);
            detectorLocal?.retarget();
          }
          return;
        } catch (erro) {
          mediaLog("falha ao restabelecer a conexao de voz", erro);
        }
      }
      callbacks.onError("A conexao de voz caiu. Tente reconectar.");
    } finally {
      recuperando = false;
    }
  }

  function faixaDoMicrofone(): MediaStreamTrack | null {
    return (
      room.localParticipant.getTrackPublication(Track.Source.Microphone)
        ?.audioTrack?.mediaStreamTrack ?? null
    );
  }

  async function iniciarDetectorLocal(): Promise<void> {
    if (detectorLocal) return;
    const faixa = faixaDoMicrofone();
    if (!faixa) return;
    try {
      const analyser = await createMicAnalyser(faixa);
      const gate = createSpeechGate({
        onChange: (speaking) => callbacks.onSpeakingChange(speaking),
      });
      let mudo = false;
      // ~40 leituras/s: o ataque parece instantaneo e o custo e desprezivel.
      const timer = setInterval(() => {
        if (mudo) {
          ultimoRmsLocal = 0;
          return;
        }
        const rms = analyser.rms();
        ultimoRmsLocal = rms;
        gate.push(rms, performance.now());
      }, 25);

      detectorLocal = {
        stop: () => {
          clearInterval(timer);
          ultimoRmsLocal = 0;
          analyser.close();
          gate.silence();
        },
        retarget: () => {
          const nova = faixaDoMicrofone();
          if (nova) analyser.retarget(nova);
        },
        setMudo: (m) => {
          mudo = m;
          if (m) gate.silence();
        },
      };
      mediaLog("detector de fala local ligado");
    } catch (erro) {
      // Sem analisador local, o ActiveSpeakersChanged acima volta a valer.
      mediaLog(
        "detector de fala local falhou; usando ActiveSpeakersChanged",
        erro,
      );
    }
  }

  /**
   * Numa reconexao o LiveKit republica o microfone: a faixa e outra, e o
   * analisador precisa reapontar ou fica medindo uma faixa morta.
   */
  room.on(RoomEvent.LocalTrackPublished, (publication) => {
    if (publication.source === Track.Source.Microphone)
      detectorLocal?.retarget();
  });

  /**
   * Parar pela barra do navegador nao passa pela nossa interface. Sem escutar
   * isto, o indicador ficaria aceso para sempre e o botao continuaria dizendo
   * "parar de compartilhar".
   */
  room.on(
    RoomEvent.LocalTrackUnpublished,
    (publication: LocalTrackPublication) => {
      if (publication.source === Track.Source.ScreenShare) {
        // Parar pela barra do navegador nao passa pelo nosso botao — o som
        // nativo precisa morrer aqui tambem, senao segue capturando sozinho.
        void pararSomNativo();
        callbacks.onLocalShareEnded();
      }
    },
  );

  room.on(RoomEvent.Disconnected, (reason) => {
    callbacks.onConnectionChange(false);
    // `disconnect()` proprio, ou um motivo terminal (expulso, sala apagada):
    // nao ha o que recuperar.
    if (encerrado || !MOTIVOS_RECUPERAVEIS.has(reason)) return;
    mediaLog("SFU desconectou — tentando recuperar", reason);
    void recuperarConexao();
  });
  room.on(RoomEvent.Reconnected, () => callbacks.onConnectionChange(true));

  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (!room.canPlaybackAudio) {
      callbacks.onError(
        "O navegador bloqueou a reproducao de audio. Clique na pagina para liberar.",
      );
    }
  });

  room.on(RoomEvent.ConnectionStateChanged, (state) =>
    mediaLog("estado da conexao", state),
  );
  room.on(RoomEvent.TrackPublished, (publication, participant) =>
    mediaLog("faixa publicada por outro", {
      de: participant.identity,
      origem: publication.source,
      inscrito: publication.isSubscribed,
    }),
  );
  room.on(RoomEvent.LocalTrackPublished, (publication) =>
    mediaLog("minha faixa publicada", publication.source),
  );

  await room.connect(url, token);
  mediaLog("conectado a sala", room.name);
  callbacks.onConnectionChange(true);

  // Politica de autoplay: precisa acontecer dentro do gesto que originou a
  // entrada na call.
  if (!room.canPlaybackAudio) {
    await room.startAudio().catch(() => undefined);
  }

  if (canPublish) {
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
      await aplicarFiltroDeRuido(room);
      await iniciarDetectorLocal();
    } catch {
      callbacks.onError(
        "Nao foi possivel abrir o microfone. Voce continua ouvindo os outros.",
      );
    }
  }

  /**
   * Empurra os niveis de audio (~11x/s) so quando alguem escuta — se
   * `onAudioLevels` nao foi passado, nao ha o que fazer. Barato: le campos que
   * o SDK ja mantem.
   */
  if (callbacks.onAudioLevels) {
    nivelTimer = setInterval(() => {
      const levels: Record<string, number> = {
        [room.localParticipant.identity]: ultimoRmsLocal,
      };
      for (const p of room.remoteParticipants.values()) {
        levels[p.identity] = p.audioLevel ?? 0;
      }
      callbacks.onAudioLevels?.(levels);
    }, 90);
  }

  return {
    async setMicrophoneEnabled(enabled) {
      if (!canPublish) return;
      // Mutar apaga a bordinha na hora, sem esperar o silencio decair.
      detectorLocal?.setMudo(!enabled);
      await room.localParticipant
        .setMicrophoneEnabled(enabled)
        .catch(() => undefined);
    },

    async setMicrophone(deviceId) {
      try {
        // Troca a fonte da faixa ja publicada: ninguem cai da call.
        await room.switchActiveDevice("audioinput", deviceId);
        // A faixa e outra agora — o analisador tem de reapontar.
        detectorLocal?.retarget();
        mediaLog("microfone trocado", deviceId);
      } catch (error) {
        mediaLog("falha ao trocar microfone", error);
        callbacks.onError(
          "Nao foi possivel usar esse microfone. Ele pode estar em uso por outro programa.",
        );
      }
    },

    async definirSupressaoAvancada(ligado) {
      return alternarFiltroDeRuido(room, ligado);
    },

    async reaplicarTratamentoNativo() {
      const faixa = room.localParticipant.getTrackPublication(
        Track.Source.Microphone,
      )?.audioTrack;
      if (!faixa) return false;
      const constraints = paraConstraints(lerTratamentoDeAudio());
      try {
        await faixa.restartTrack(constraints);
        // A faixa e outra agora — o analisador reaponta.
        detectorLocal?.retarget();
        mediaLog("tratamento nativo reaplicado", constraints);
        return true;
      } catch (erro) {
        mediaLog("falha ao reaplicar o tratamento nativo", erro);
        // `restartTrack` pode ter parado a faixa antiga no meio do caminho.
        await room.localParticipant
          .setMicrophoneEnabled(true)
          .catch(() => undefined);
        detectorLocal?.retarget();
        callbacks.onError(
          "Nao consegui aplicar a mudanca de audio sem reconectar. O microfone continua ligado; se ficou mudo, saia e entre de novo.",
        );
        return false;
      }
    },

    setDeafened(next) {
      deafened = next;
      reapplyAll();
    },

    setUserVolume(userId, volume) {
      userVolumes.set(userId, clampVolume(volume));
      const bucket = attachedAudio.get(userId);
      if (!bucket) return;
      for (const element of bucket.mic) applyVolume(element, userId, false);
    },

    setScreenAudioVolume(volume) {
      screenVolume = clampVolume(volume);
      for (const [identity, bucket] of attachedAudio) {
        for (const element of bucket.screen) {
          applyVolume(element, identity, true);
        }
      }
    },

    /**
     * Troca o alto-falante de TUDO que ja esta tocando (mic dos outros e som
     * de tela) e guarda a escolha para as proximas faixas, que chegam depois
     * desta chamada retornar.
     */
    async setOutputDevice(deviceId) {
      preferredSpeaker = deviceId;
      savePreferredSpeaker(deviceId);

      const elements = [...attachedAudio.values()].flatMap((bucket) => [
        ...bucket.mic,
        ...bucket.screen,
      ]);
      if (elements.length === 0) return;

      const withSink = elements[0] as HTMLMediaElement & {
        setSinkId?: (sinkId: string) => Promise<void>;
      };
      if (typeof withSink.setSinkId !== "function") {
        callbacks.onError(
          "Este navegador nao permite escolher o alto-falante de saida.",
        );
        return;
      }

      const results = await Promise.allSettled(
        elements.map((element) =>
          (
            element as HTMLMediaElement & {
              setSinkId?: (sinkId: string) => Promise<void>;
            }
          ).setSinkId?.(deviceId),
        ),
      );
      if (results.some((result) => result.status === "rejected")) {
        mediaLog("falha ao trocar o alto-falante", results);
        callbacks.onError(
          "Nao foi possivel usar esse alto-falante. Ele pode ter sido desconectado.",
        );
      }
    },

    subscribeConnectionStats(cb) {
      return startConnectionStats(room, cb);
    },

    /**
     * Captura a tela UMA vez e publica.
     *
     * A versao anterior pedia captura com audio e, se algo falhasse, tentava
     * de novo sem audio — o que reabria o seletor nativo do Chrome. O sintoma
     * era exatamente "escolhi tela inteira com audio e apareceu a janela de
     * escolha de novo, agora sem a opcao de audio".
     *
     * A causa: `setScreenShareEnabled` cria as DUAS faixas (video e audio) e
     * publica as duas. Se a publicacao do AUDIO falhava, o erro subia e a
     * captura inteira era refeita — jogando fora um video que estava perfeito.
     *
     * Agora: uma captura, e publicacao em duas etapas. O VIDEO e essencial e
     * publicado primeiro; o AUDIO e melhor-esforco e nao pode derrubar a
     * transmissao. Nao existe segunda chamada a getDisplayMedia em nenhum
     * caminho.
     */
    async startScreenShare(presetId, withSystemAudio) {
      const preset = SHARE_PRESETS[presetId];

      /** Cancelar o seletor nativo nao e falha, e escolha — nao insistir. */
      function isCancellation(error: unknown): boolean {
        return (
          error instanceof DOMException &&
          (error.name === "NotAllowedError" || error.name === "AbortError")
        );
      }

      /**
       * DISPONIBILIDADE, e nao vontade.
       *
       * Isto decide como PEDIR a captura, e por isso nao pode depender de a
       * pessoa querer som: havendo modulo nativo, o video vem sozinho de
       * qualquer jeito, e o som (se pedido) vem por fora.
       *
       * A primeira versao juntava as duas coisas — `withSystemAudio && ...` — e
       * o caminho nativo nunca era usado no desktop, porque ali a caixa de som
       * fica no SELETOR e o `withSystemAudio` do navegador nem e exibido. O
       * log mostrava `loopback.disponivel: sim` e, na linha seguinte, o erro do
       * Chromium.
       */
      const temNativo = await podeCapturarSomDoSistema();

      let tracks;
      try {
        /**
         * `audio: true` nao FORCA audio: quando a superficie escolhida nao o
         * oferece (ou a pessoa nao liga a chave), o navegador simplesmente
         * devolve so o video. Isso e o caso normal, nao um erro.
         */
        /**
         * Com o modulo nativo disponivel, o video vem SOZINHO e o som vem por
         * fora. Isso desfaz o tudo-ou-nada que derrubava a tela junto com o
         * som: `getDisplayMedia({audio:true})` falha INTEIRO quando a captura
         * de som e recusada, e era isso que acontecia no fone sem fio.
         */
        tracks = await createLocalScreenTracks({
          /**
           * Sem o nativo, no desktop pedimos audio SEMPRE: o Chromium so
           * entrega faixa de som se o renderer tambem pedir, entao mandar
           * `false` faria a chave do seletor do Electron nao ter efeito. Quem
           * decide la e o seletor.
           */
          audio: temNativo ? false : isDesktopApp() ? true : withSystemAudio,
          contentHint: preset.contentHint,
          resolution: {
            width: preset.width,
            height: preset.height,
            frameRate: preset.frameRate,
          },
        });
      } catch (error) {
        if (isCancellation(error)) return false;
        mediaLog("getDisplayMedia falhou", error);

        /**
         * O sistema recusou abrir a captura de SOM. A tela funcionaria
         * perfeitamente sem ele, mas `getDisplayMedia` e tudo-ou-nada: o
         * pedido inteiro falha.
         *
         * Nao tentamos de novo automaticamente — era isso que reabria o
         * seletor nativo. Em vez disso desligamos a opcao e LEMBRAMOS, para
         * que a proxima tentativa ja saia sem som e funcione de primeira.
         */
        if (isAudioSourceError(error) && isDesktopApp()) {
          /**
           * No desktop pedimos audio SEMPRE (o seletor proprio decide), entao
           * a preferencia que precisa desligar e a DELE, la no main process —
           * a `saveShareAudioPreference` abaixo e so localStorage do navegador
           * e nao teria efeito nenhum aqui. Sem este aviso, a proxima
           * tentativa pediria som de novo e cairia no MESMO erro pra sempre:
           * foi exatamente isso que aconteceu com o dongle de audio sem fio.
           */
          void reportDesktopAudioFailure(error);
          /**
           * A mensagem diz o que sabemos, e nao o que parece.
           *
           * A versao anterior afirmava que "o loopback so funciona no
           * dispositivo com fio ou onboard" — o que se mostrou FALSO quando
           * medimos: o loopback do Windows grava desse mesmo fone sem fio (o
           * Xbox Game Bar faz isso). Quem nao consegue usa-lo e o Chromium.
           *
           * Dizer a causa errada e pior do que nao dizer nenhuma: manda a
           * pessoa mexer no lugar errado.
           */
          callbacks.onError(
            "O Chromium nao conseguiu abrir a captura do som do sistema nesta " +
              "saida de audio. O Windows CONSEGUE gravar dela — a limitacao e " +
              "do navegador embutido, e um modulo nativo esta em construcao " +
              "para contornar isso. Por enquanto desliguei o som: e so clicar " +
              "em compartilhar de novo que a tela vai normalmente. Se voce " +
              "trocar a saida padrao do Windows, o som volta a ser tentado " +
              "sozinho.",
          );
          return false;
        }

        if (withSystemAudio && isAudioSourceError(error)) {
          saveShareAudioPreference(false);
          callbacks.onError(
            "Seu sistema nao deixou capturar o som da TELA. Desliguei a opcao " +
              "e a tela vai normalmente — e so clicar de novo. " +
              "Para levar som: marque a opcao outra vez e compartilhe uma ABA " +
              "do navegador, que usa outro caminho de captura e costuma " +
              "funcionar mesmo quando o som do sistema falha.",
          );
          return false;
        }

        callbacks.onError(
          error instanceof Error
            ? `Nao foi possivel compartilhar: ${error.message}`
            : "Nao foi possivel compartilhar a tela.",
        );
        return false;
      }

      const videoTrack = tracks.find(
        (track) => track.kind === Track.Kind.Video,
      );
      const audioTrack = tracks.find(
        (track) => track.kind === Track.Kind.Audio,
      );

      /**
       * `createLocalScreenTracks` marca as fontes (ScreenShare e
       * ScreenShareAudio) mas NAO aplica o contentHint — diferente do caminho
       * interno do `setScreenShareEnabled`. Sem isto aqui, trocariamos um
       * seletor duplicado por uma regressao silenciosa no parametro que mais
       * decide a qualidade percebida.
       */
      if (videoTrack) {
        videoTrack.mediaStreamTrack.contentHint = preset.contentHint;
      }

      if (!videoTrack) {
        for (const track of tracks) track.stop();
        callbacks.onError("A captura nao devolveu imagem. Tente de novo.");
        return false;
      }

      try {
        /**
         * O CODEC E DECIDIDO AQUI, na publicacao.
         *
         * Nao por `setCodecPreferences` no transceiver: quem possui a
         * `RTCPeerConnection` e o LiveKit, e ele a recria a cada reconexao e
         * renegociacao. Uma preferencia posta por fora seria desfeita no
         * primeiro desses eventos — e em silencio, com a call seguindo no
         * codec errado.
         *
         * `undefined` deixa o SDK escolher, que e o padrao e o recomendado:
         * ele leva em conta o que o navegador consegue codificar em hardware.
         */
        const codecEscolhido = lerCodecDeTela();
        await room.localParticipant.publishTrack(videoTrack, {
          ...(codecEscolhido ? { videoCodec: codecEscolhido } : {}),
          screenShareEncoding: {
            maxBitrate: preset.maxBitrate,
            maxFramerate: preset.frameRate,
          },
        });
      } catch (error) {
        for (const track of tracks) track.stop();
        mediaLog("falha ao publicar o video da tela", error);
        callbacks.onError(
          error instanceof Error
            ? `Nao foi possivel compartilhar: ${error.message}`
            : "Nao foi possivel compartilhar a tela.",
        );
        return false;
      }

      /**
       * O som pelo caminho nativo, quando ele existe.
       *
       * Publicado DEPOIS do video e de proposito: se algo aqui falhar, a tela
       * ja esta no ar. Som e um degrau; tela e a transmissao.
       */
      /**
       * A VONTADE, esta sim, decide se capturamos o som. No desktop a resposta
       * mora no seletor; no navegador, na barra de controles.
       */
      const querSom = temNativo
        ? isDesktopApp()
          ? await pediuSomNoSeletor()
          : withSystemAudio
        : false;

      if (querSom) {
        const som = await capturarSomDoSistema();
        if (som) {
          try {
            await room.localParticipant.publishTrack(som.track, {
              source: Track.Source.ScreenShareAudio,
            });
            somNativo = som;
          } catch (error) {
            await som.parar();
            mediaLog("falha ao publicar o som nativo", error);
            callbacks.onError(
              "A tela esta sendo compartilhada, mas o som do sistema nao pode ser enviado.",
            );
          }
        } else {
          /**
           * A recusa aqui pode ser DELIBERADA, e nao so uma falha.
           *
           * O modulo nativo so captura o som da tela quando consegue deixar o
           * proprio Aether de fora. Sem isso ele mandaria a call inteira de
           * volta para a call — cada pessoa ouvindo a propria voz. Entre a
           * tela ir sem som e a conversa ficar impossivel para todos, ele
           * escolhe ir sem som, e a mensagem diz isso.
           */
          callbacks.onError(
            "A tela esta indo, porem SEM som. So mandamos o som da tela " +
              "quando da para tirar a propria chamada da captura — senao " +
              "todo mundo ouviria a propria voz de volta. O log do app " +
              "registra o motivo exato.",
          );
        }
      }

      if (audioTrack) {
        try {
          await room.localParticipant.publishTrack(audioTrack);
        } catch (error) {
          /**
           * O video ja esta no ar e continua. Perder o som e uma degradacao,
           * nao um motivo para derrubar a transmissao inteira — que era
           * exatamente o que acontecia antes.
           */
          audioTrack.stop();
          mediaLog("falha ao publicar o audio da tela", error);
          callbacks.onError(
            "A tela esta sendo compartilhada, mas o som do sistema nao pode ser enviado.",
          );
        }
      } else if (withSystemAudio && !temNativo) {
        // So avisa quem PEDIU som e nao recebeu. Quem escolheu compartilhar
        // sem som nao precisa de aviso sobre algo que nao pediu — e quem
        // recebeu pelo caminho nativo ja esta com som.
        callbacks.onError(
          "Compartilhando sem o som do sistema. Na janela de escolha, ligue " +
            '"Compartilhar tambem o audio do sistema" — o Windows oferece isso ' +
            "para ABA e TELA INTEIRA, mas nao para uma janela avulsa.",
        );
      }

      return true;
    },

    /**
     * Troca a qualidade SEM republicar a faixa.
     *
     * O caminho obvio — parar e comecar de novo com outro preset — reabriria o
     * seletor nativo do Chrome, obrigando a pessoa a escolher a janela outra
     * vez no meio da conversa. `restartTrack()` do LiveKit tem o mesmo
     * problema: para captura de tela ele chama `getDisplayMedia` de novo.
     *
     * Entao mexemos nos tres lugares que aceitam mudanca ao vivo:
     *
     *  1. `contentHint` — propriedade da MediaStreamTrack. E o que decide o que
     *     o codificador sacrifica quando a banda aperta (nitidez ou fluidez), e
     *     e o parametro que mais muda a sensacao de qualidade.
     *  2. `applyConstraints` — reduz resolucao e quadros na propria captura,
     *     sem novo gesto do usuario.
     *  3. parametros do RTCRtpSender — o teto de bitrate do encoder.
     *
     * Cada passo e independente: se `applyConstraints` falhar (o suporte varia
     * entre navegadores para faixa de tela), os outros dois ainda valem, e a
     * qualidade muda de verdade — so nao na resolucao.
     */
    async setSharePreset(presetId) {
      const publication = room.localParticipant.getTrackPublication(
        Track.Source.ScreenShare,
      );
      const track = publication?.track;
      if (!track || !(track instanceof LocalVideoTrack)) return false;

      const preset = SHARE_PRESETS[presetId];
      mediaLog("trocando qualidade da tela", presetId);

      track.mediaStreamTrack.contentHint = preset.contentHint;

      await track.mediaStreamTrack
        .applyConstraints({
          width: { max: preset.width },
          height: { max: preset.height },
          frameRate: { max: preset.frameRate },
        })
        .catch((error: unknown) => {
          /**
           * Nao vira erro para o usuario: os outros dois passos ja mudaram a
           * transmissao, e avisar "falhou" quando a qualidade mudou seria
           * mentira. Fica no log de midia para quem estiver depurando.
           */
          mediaLog("applyConstraints recusado na faixa de tela", error);
        });

      const sender = track.sender;
      if (sender) {
        try {
          const params = sender.getParameters();
          if (params.encodings && params.encodings.length > 0) {
            for (const encoding of params.encodings) {
              encoding.maxBitrate = preset.maxBitrate;
              encoding.maxFramerate = preset.frameRate;
            }
            await sender.setParameters(params);
          }
        } catch (error) {
          mediaLog("nao consegui ajustar o bitrate do encoder", error);
        }
      }

      return true;
    },

    /**
     * Liga ou desliga a camera.
     *
     * Quem recusa de verdade e o SFU: a fonte CAMERA so entra no token de quem
     * tem a permissao. A interface esconde o botao por conveniencia, e nao por
     * seguranca — as duas coisas nunca sao a mesma aqui.
     *
     * `false` quando nao deu, para a interface nao acender um indicador que
     * nao corresponde a faixa nenhuma.
     */
    async setCameraEnabled(enabled, deviceId) {
      try {
        await room.localParticipant.setCameraEnabled(
          enabled,
          deviceId ? { deviceId } : undefined,
        );
        return true;
      } catch (error) {
        mediaLog("nao consegui mudar a camera", error);
        callbacks.onError(explicarErroDeCamera(error, enabled));
        return false;
      }
    },

    localCameraTrack() {
      const publication = room.localParticipant.getTrackPublication(
        Track.Source.Camera,
      );
      return publication?.track ?? null;
    },

    async stopScreenShare() {
      await pararSomNativo();
      await room.localParticipant
        .setScreenShareEnabled(false)
        .catch(() => undefined);
    },

    localScreenTrack() {
      const publication = room.localParticipant.getTrackPublication(
        Track.Source.ScreenShare,
      );
      return publication?.track ?? null;
    },

    async disconnect() {
      // Antes de qualquer coisa: barra a recuperacao automatica. Sem isto, o
      // `RoomEvent.Disconnected` disparado pelo `room.disconnect()` abaixo
      // entraria no laco de reconexao.
      encerrado = true;
      detectorLocal?.stop();
      detectorLocal = null;
      if (nivelTimer) clearInterval(nivelTimer);
      nivelTimer = null;
      // Antes de tudo: a thread de captura no processo principal nao pode
      // sobreviver a sala que a motivou.
      await pararSomNativo();

      for (const bucket of attachedAudio.values()) {
        for (const element of [...bucket.mic, ...bucket.screen]) {
          element.remove();
        }
      }
      attachedAudio.clear();
      screenShares.clear();
      await room.disconnect();
    },
  };
}
