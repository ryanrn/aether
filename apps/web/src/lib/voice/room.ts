"use client";

import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from "livekit-client";

/**
 * Conexao com a sala de midia (SFU).
 *
 * Este modulo NAO decide nada: ele recebe um token que ja carrega, assinado,
 * o que o usuario pode fazer. Se o token nao permite publicar microfone, a
 * chamada falha no proprio SFU — nao dependemos de a interface se comportar.
 *
 * O audio remoto e reproduzido por elementos <audio> criados aqui e presos a
 * um container fora da arvore do React. Deixar o React montar/desmontar esses
 * elementos causaria cortes no som a cada re-render.
 */

export interface VoiceRoomCallbacks {
  /** o proprio usuario comecou/parou de falar — segue para o nosso gateway */
  onSpeakingChange: (speaking: boolean) => void;
  onConnectionChange: (connected: boolean) => void;
  onError: (message: string) => void;
}

export interface VoiceRoomHandle {
  setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
  /** ensurdecer: para de reproduzir o audio dos outros */
  setDeafened: (deafened: boolean) => void;
  disconnect: () => Promise<void>;
}

/** Container dos <audio> remotos, fora do controle do React. */
function audioContainer(): HTMLElement {
  const existing = document.getElementById("aether-audio-sink");
  if (existing) return existing;
  const element = document.createElement("div");
  element.id = "aether-audio-sink";
  element.style.display = "none";
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
  const room = new Room({
    // Cancelamento de eco e supressao de ruido no proprio navegador: sem isso,
    // caixa de som aberta devolve a voz dos outros para dentro da call.
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    // Adapta o bitrate a rede de quem recebe em vez de derrubar a faixa.
    adaptiveStream: true,
    dynacast: true,
  });

  const sink = audioContainer();
  const attached = new Map<string, HTMLMediaElement[]>();
  let deafened = false;

  room.on(
    RoomEvent.TrackSubscribed,
    (
      track: RemoteTrack,
      _publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (track.kind !== Track.Kind.Audio) return;
      const element = track.attach();
      element.muted = deafened;
      // `autoplay` sem interacao pode ser bloqueado; a entrada na call e um
      // clique, entao o contexto de gesto ja existe quando chegamos aqui.
      sink.appendChild(element);
      const list = attached.get(participant.identity) ?? [];
      list.push(element);
      attached.set(participant.identity, list);
    },
  );

  room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
    for (const element of track.detach()) element.remove();
  });

  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    for (const element of attached.get(participant.identity) ?? []) {
      element.remove();
    }
    attached.delete(participant.identity);
  });

  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    const speaking = speakers.some(
      (speaker) => speaker.identity === room.localParticipant.identity,
    );
    callbacks.onSpeakingChange(speaking);
  });

  room.on(RoomEvent.Disconnected, () => callbacks.onConnectionChange(false));
  room.on(RoomEvent.Reconnected, () => callbacks.onConnectionChange(true));

  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (!room.canPlaybackAudio) {
      callbacks.onError(
        "O navegador bloqueou a reproducao de audio. Clique na pagina para liberar.",
      );
    }
  });

  await room.connect(url, token);
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
      for (const elements of attached.values()) {
        for (const element of elements) element.muted = next;
      }
    },

    async disconnect() {
      for (const elements of attached.values()) {
        for (const element of elements) element.remove();
      }
      attached.clear();
      await room.disconnect();
    },
  };
}
