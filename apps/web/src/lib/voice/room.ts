"use client";

import {
  createLocalScreenTracks,
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
import {
  isAudioSourceError,
  isDesktopApp,
  reportDesktopAudioFailure,
  saveShareAudioPreference,
  SHARE_PRESETS,
  type SharePresetId,
} from "./screen-share";
import { mediaDebugEnabled, mediaLog } from "./debug";
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

export interface VoiceRoomCallbacks {
  /** o proprio usuario comecou/parou de falar — segue para o nosso gateway */
  onSpeakingChange: (speaking: boolean) => void;
  onConnectionChange: (connected: boolean) => void;
  /** alguem comecou ou parou de compartilhar tela na sala */
  onScreenSharesChange: (shares: RemoteScreenShare[]) => void;
  /**
   * A transmissao local terminou. Inclui o caso de a pessoa clicar em "parar
   * de compartilhar" na barra do proprio navegador, que nao passa pela nossa
   * interface.
   */
  onLocalShareEnded: () => void;
  onError: (message: string) => void;
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
  /** para ONDE tocamos o audio recebido — mic dos outros e som de tela */
  setOutputDevice: (deviceId: string) => Promise<void>;
  disconnect: () => Promise<void>;
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
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
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

      /**
       * Qualquer video que chegue aqui e compartilhamento de tela: este app
       * nunca publica camera. Filtrar por `publication.source` era fragil —
       * se a origem ainda nao estivesse resolvida no momento da inscricao, a
       * faixa era descartada em silencio e nao havia nova chance.
       */
      if (track.kind !== Track.Kind.Video) return;

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
    },
  );

  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    const bucket = attachedAudio.get(participant.identity);
    for (const element of [...(bucket?.mic ?? []), ...(bucket?.screen ?? [])]) {
      element.remove();
    }
    attachedAudio.delete(participant.identity);
    if (screenShares.delete(participant.identity)) publishScreenShares();
  });

  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    const speaking = speakers.some(
      (speaker) => speaker.identity === room.localParticipant.identity,
    );
    callbacks.onSpeakingChange(speaking);
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
        callbacks.onLocalShareEnded();
      }
    },
  );

  room.on(RoomEvent.Disconnected, () => callbacks.onConnectionChange(false));
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
    } catch {
      callbacks.onError(
        "Nao foi possivel abrir o microfone. Voce continua ouvindo os outros.",
      );
    }
  }

  return {
    async setMicrophoneEnabled(enabled) {
      if (!canPublish) return;
      await room.localParticipant
        .setMicrophoneEnabled(enabled)
        .catch(() => undefined);
    },

    async setMicrophone(deviceId) {
      try {
        // Troca a fonte da faixa ja publicada: ninguem cai da call.
        await room.switchActiveDevice("audioinput", deviceId);
        mediaLog("microfone trocado", deviceId);
      } catch (error) {
        mediaLog("falha ao trocar microfone", error);
        callbacks.onError(
          "Nao foi possivel usar esse microfone. Ele pode estar em uso por outro programa.",
        );
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

      let tracks;
      try {
        /**
         * `audio: true` nao FORCA audio: quando a superficie escolhida nao o
         * oferece (ou a pessoa nao liga a chave), o navegador simplesmente
         * devolve so o video. Isso e o caso normal, nao um erro.
         */
        tracks = await createLocalScreenTracks({
          /**
           * No desktop pedimos audio SEMPRE: o Chromium so entrega faixa de
           * som se o renderer tambem pedir, entao mandar `false` aqui faria a
           * chave do seletor do Electron nao ter efeito nenhum. Quem decide
           * la e o seletor.
           */
          audio: isDesktopApp() ? true : withSystemAudio,
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
          reportDesktopAudioFailure();
          callbacks.onError(
            "O dispositivo de saida de audio padrao do Windows nao deixou capturar " +
              "o som do sistema (comum em fones/dongles sem fio — o loopback so " +
              "funciona de forma confiavel no dispositivo com fio ou onboard). " +
              "Desliguei o som no seletor de tela — e so clicar em compartilhar de " +
              "novo, a tela vai normalmente. Para tentar com som outra vez, troque " +
              "a saida padrao do Windows antes de compartilhar.",
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

      const videoTrack = tracks.find((track) => track.kind === Track.Kind.Video);
      const audioTrack = tracks.find((track) => track.kind === Track.Kind.Audio);

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
        await room.localParticipant.publishTrack(videoTrack, {
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
      } else if (withSystemAudio) {
        // So avisa quem PEDIU som e nao recebeu. Quem escolheu compartilhar
        // sem som nao precisa de aviso sobre algo que nao pediu.
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

    async stopScreenShare() {
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
