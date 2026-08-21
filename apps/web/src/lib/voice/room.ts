"use client";

import {
  Room,
  RoomEvent,
  setLogLevel,
  Track,
  type LocalTrackPublication,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from "livekit-client";
import { SHARE_PRESETS, type SharePresetId } from "./screen-share";
import { mediaDebugEnabled, mediaLog } from "./debug";

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
  /** ensurdecer: para de reproduzir o audio dos outros */
  setDeafened: (deafened: boolean) => void;
  /** abre o seletor nativo do navegador e publica. `false` se o usuario cancelou. */
  startScreenShare: (preset: SharePresetId) => Promise<boolean>;
  stopScreenShare: () => Promise<void>;
  /** faixa local de tela, para a previa de quem esta transmitindo */
  localScreenTrack: () => Track | null;
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

  const room = new Room({
    // Cancelamento de eco e supressao de ruido no proprio navegador: sem isso,
    // caixa de som aberta devolve a voz dos outros para dentro da call.
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
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
  const attachedAudio = new Map<string, HTMLMediaElement[]>();
  let deafened = false;

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
        // Audio de tela vem junto do compartilhamento e toca como qualquer
        // outro audio da sala — nao ha nada a desenhar.
        const element = track.attach();
        element.muted = deafened;
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
        const list = attachedAudio.get(participant.identity) ?? [];
        list.push(element);
        attachedAudio.set(participant.identity, list);
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
    for (const element of attachedAudio.get(participant.identity) ?? []) {
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

    setDeafened(next) {
      deafened = next;
      for (const elements of attachedAudio.values()) {
        for (const element of elements) element.muted = next;
      }
    },

    async startScreenShare(presetId) {
      const preset = SHARE_PRESETS[presetId];

      function capture(withAudio: boolean) {
        return room.localParticipant.setScreenShareEnabled(
          true,
          {
            audio: withAudio,
            contentHint: preset.contentHint,
            resolution: {
              width: preset.width,
              height: preset.height,
              frameRate: preset.frameRate,
            },
          },
          {
            screenShareEncoding: {
              maxBitrate: preset.maxBitrate,
              maxFramerate: preset.frameRate,
            },
          },
        );
      }

      /** Cancelar o seletor nativo nao e falha, e escolha — nao insistir. */
      function isCancellation(error: unknown): boolean {
        return (
          error instanceof DOMException &&
          (error.name === "NotAllowedError" || error.name === "AbortError")
        );
      }

      try {
        // Primeira tentativa COM audio do sistema: quando funciona, o som do
        // jogo ou do video vai junto, que e o que se espera.
        await capture(true);
        return true;
      } catch (error) {
        if (isCancellation(error)) return false;

        /**
         * Pedir audio e all-or-nothing no getDisplayMedia: se o sistema nao
         * consegue abrir a fonte de som ("Could not start audio source"), a
         * captura inteira falha — inclusive o video, que funcionaria.
         *
         * Depende do sistema operacional, do navegador e do tipo de superficie
         * escolhida (tela inteira costuma nao oferecer audio; aba costuma
         * oferecer). Como nao da para saber antes, tentamos de novo sem audio
         * em vez de transformar isso em erro para o usuario.
         */
        try {
          await capture(false);
          callbacks.onError(
            "Compartilhando sem o audio do sistema — seu navegador nao o disponibilizou. Para levar o som junto, compartilhe uma ABA do navegador.",
          );
          return true;
        } catch (retryError) {
          if (isCancellation(retryError)) return false;
          callbacks.onError(
            retryError instanceof Error
              ? `Nao foi possivel compartilhar: ${retryError.message}`
              : "Nao foi possivel compartilhar a tela.",
          );
          return false;
        }
      }
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
      for (const elements of attachedAudio.values()) {
        for (const element of elements) element.remove();
      }
      attachedAudio.clear();
      screenShares.clear();
      await room.disconnect();
    },
  };
}
