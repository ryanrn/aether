"use client";

import { useMemo } from "react";
import { create } from "zustand";
import type {
  MediaGrant,
  PresenceEntry,
  PublicMessage,
  UserStatus,
  VoiceParticipant,
} from "@aether/shared";
import type { Track } from "livekit-client";
import type { RemoteScreenShare } from "@/lib/voice/room";
import { DEFAULT_PRESET, type SharePresetId } from "@/lib/voice/screen-share";

/**
 * Estado global de tempo real: presenca, voz e mensagens.
 *
 * Por que Zustand e nao Context: Context re-renderiza TODO consumidor a cada
 * mudanca. Com mensagens chegando, isso significaria re-renderizar o painel de
 * membros e a arvore de canais a cada linha de chat. Zustand entrega por
 * seletor — quem le mensagens de um canal so acorda quando aquele canal muda.
 *
 * A store guarda apenas estado. Quem fala com o socket e o RealtimeProvider;
 * quem decide permissao e o servidor. Aqui nao ha regra de negocio.
 */

/** Mensagem na tela pode ainda nao existir no banco (envio otimista). */
export interface ChatMessage extends PublicMessage {
  /** enviada, aguardando confirmacao do gateway */
  pending?: boolean;
  /** o envio falhou; guardamos o motivo para a UI mostrar */
  failed?: string;
  /** id local que reconcilia a mensagem otimista com a confirmada */
  nonce?: string;
}

interface ChannelHistory {
  hasMore: boolean;
  loading: boolean;
}

/**
 * Tri-estado de proposito: "conectando" e "caiu" NAO sao a mesma coisa para
 * quem olha a tela. Um booleano faria o primeiro paint anunciar queda de
 * conexao antes mesmo de a primeira tentativa acontecer.
 */
export type ConnectionStatus = "connecting" | "online" | "offline";

interface RealtimeState {
  connectionStatus: ConnectionStatus;
  selfUserId: string | null;
  serverId: string | null;
  error: string | null;
  /** problema de microfone — separado do erro de conexao, causa diferente */
  voiceError: string | null;

  presence: Record<string, UserStatus>;
  /**
   * Jogo por usuario, SEPARADO de `presence`.
   *
   * Podia ser um campo dentro de `presence`, mas ali o valor e um `UserStatus`
   * cru, lido em varios pontos como `presence[id] ?? "OFFLINE"`. Trocar o
   * formato obrigaria a mexer em todos eles para acrescentar um dado que a
   * maioria nem usa. Mapa separado: quem quer status continua igual, quem quer
   * jogo pede o jogo.
   */
  activity: Record<
    string,
    {
      game: string;
      since: string | null;
      /** icone do executavel (data URL), da maquina de quem joga */
      icon: string | null;
      /** capa do IGDB (URL), resolvida pelo servidor; chega depois do icone */
      cover: string | null;
    }
  >;
  voice: Record<string, VoiceParticipant>;
  /** credenciais do SFU, validas so enquanto voce esta na call */
  media: MediaGrant | null;
  /** a sala de midia esta conectada de fato (nao e o mesmo que estar no canal) */
  mediaConnected: boolean;
  /** compartilhamentos de tela recebidos na sala */
  screenShares: RemoteScreenShare[];
  /** o proprio usuario esta transmitindo */
  localSharing: boolean;
  /** perfil de qualidade da MINHA transmissao — a interface marca o ativo */
  sharePreset: SharePresetId;
  /** faixa local, para voce conferir o que esta enviando */
  localShareTrack: Track | null;
  /** qual compartilhamento esta em destaque; null = o primeiro disponivel */
  focusedShareUserId: string | null;
  /**
   * Comandos de midia, publicados pela sessao enquanto ela existe.
   *
   * Ficam na store porque quem dispara (a barra de controles) e quem detem a
   * conexao (a sessao no layout) estao em ramos diferentes da arvore. A
   * alternativa seria mais um contexto so para isso.
   */
  roomControls: {
    startShare: (
      preset: SharePresetId,
      withSystemAudio: boolean,
    ) => Promise<boolean>;
    stopShare: () => Promise<void>;
    setMicrophone: (deviceId: string) => Promise<void>;
    /** para ONDE tocamos o audio recebido — mic dos outros e som de tela */
    setOutputDevice: (deviceId: string) => Promise<void>;
    /** volume local com que EU ouço o microfone de alguem (0..1) */
    setUserVolume: (userId: string, volume: number) => void;
    /** volume local do audio que vem junto do compartilhamento de tela (0..1) */
    setScreenAudioVolume: (volume: number) => void;
    /** troca a qualidade da transmissao ativa, sem reabrir o seletor de tela */
    setSharePreset: (preset: SharePresetId) => Promise<boolean>;
  } | null;
  messages: Record<string, ChatMessage[]>;
  history: Record<string, ChannelHistory>;
  /** canal aberto agora — mensagem que chega nele ja nasce lida */
  activeChannelId: string | null;
  /** mensagens nao lidas por canal */
  unread: Record<string, number>;

  setConnectionStatus: (status: ConnectionStatus) => void;
  setSelfUserId: (userId: string) => void;
  setError: (error: string | null) => void;
  setVoiceError: (error: string | null) => void;
  /** troca de servidor zera tudo que era daquele servidor */
  enterServer: (serverId: string) => void;
  clearVolatile: () => void;

  syncPresence: (entries: PresenceEntry[]) => void;
  /** mesmo dado, mas SOMANDO ao que ja existe — ver a implementacao */
  mergePresence: (entries: PresenceEntry[]) => void;
  updatePresence: (entry: PresenceEntry) => void;

  syncVoice: (participants: VoiceParticipant[]) => void;
  updateVoice: (participant: VoiceParticipant) => void;
  setMedia: (media: MediaGrant | null) => void;
  setMediaConnected: (connected: boolean) => void;
  setScreenShares: (shares: RemoteScreenShare[]) => void;
  setLocalSharing: (sharing: boolean, track?: Track | null) => void;
  setSharePreset: (preset: SharePresetId) => void;
  setFocusedShare: (userId: string | null) => void;
  setRoomControls: (controls: RealtimeState["roomControls"]) => void;

  seedMessages: (channelId: string, messages: PublicMessage[]) => void;
  receiveMessage: (message: PublicMessage, nonce: string | null) => void;
  addPending: (message: ChatMessage) => void;
  failPending: (channelId: string, nonce: string, error: string) => void;
  prependHistory: (
    channelId: string,
    messages: PublicMessage[],
    hasMore: boolean,
  ) => void;
  setHistoryLoading: (channelId: string, loading: boolean) => void;
  setActiveChannel: (channelId: string | null) => void;
}

const EMPTY_MESSAGES: ChatMessage[] = [];
const DEFAULT_HISTORY: ChannelHistory = { hasMore: true, loading: false };

/** Ordena por data e remove duplicata por id — historico e socket se sobrepoem. */
function mergeById(
  current: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of [...current, ...incoming]) {
    byId.set(message.id, { ...byId.get(message.id), ...message });
  }
  return [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id.localeCompare(b.id)
      : a.createdAt.localeCompare(b.createdAt),
  );
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  connectionStatus: "connecting",
  selfUserId: null,
  serverId: null,
  error: null,
  voiceError: null,
  presence: {},
  activity: {},
  voice: {},
  media: null,
  mediaConnected: false,
  screenShares: [],
  localSharing: false,
  sharePreset: DEFAULT_PRESET,
  localShareTrack: null,
  focusedShareUserId: null,
  roomControls: null,
  messages: {},
  history: {},
  activeChannelId: null,
  unread: {},

  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setSelfUserId: (selfUserId) => set({ selfUserId }),
  setError: (error) => set({ error }),
  setVoiceError: (voiceError) => set({ voiceError }),

  enterServer: (serverId) =>
    set((state) =>
      state.serverId === serverId
        ? { serverId }
        : {
            unread: {},
            activeChannelId: null,
            serverId,
            presence: {},
            activity: {},
            voice: {},
            media: null,
            mediaConnected: false,
            messages: {},
            history: {},
          },
    ),

  /**
   * Sem conexao nao sabemos quem esta online nem quem esta em call; manter o
   * ultimo estado na tela seria apresentar como atual algo que nao e.
   * Mensagens ficam: elas sao historico, nao estado vivo.
   */
  clearVolatile: () =>
    // O token de midia morre junto: ele foi emitido para uma entrada em canal
    // que nao vale mais. As tracks tambem, porque pertencem a sala que caiu.
    set({
      presence: {},
      activity: {},
      voice: {},
      media: null,
      mediaConnected: false,
      screenShares: [],
      localSharing: false,
      localShareTrack: null,
      focusedShareUserId: null,
    }),

  syncPresence: (entries) =>
    set({
      presence: Object.fromEntries(entries.map((e) => [e.userId, e.status])),
      activity: Object.fromEntries(
        entries
          .filter((e) => e.game)
          .map((e) => [
            e.userId,
            {
              game: e.game as string,
              since: e.gameSince,
              icon: e.gameIcon,
              cover: e.gameCover,
            },
          ]),
      ),
    }),

  /**
   * Igual ao `syncPresence`, mas SOMA em vez de substituir.
   *
   * Existe por causa do `friend:sync`, que chega pela sala pessoal e pode
   * chegar enquanto voce esta dentro de um servidor. Usar `syncPresence` ali
   * apagaria a presenca do servidor inteiro e deixaria na tela so os amigos —
   * todo mundo apareceria offline ate o proximo evento de cada um.
   *
   * Os dois mapas convivem sem conflito: para quem e amigo E membro, os dois
   * caminhos carregam o mesmo estado, vindo do mesmo lugar no gateway.
   */
  mergePresence: (entries) =>
    set((state) => {
      const presence = { ...state.presence };
      const activity = { ...state.activity };
      for (const entrada of entries) {
        presence[entrada.userId] = entrada.status;
        if (entrada.game) {
          activity[entrada.userId] = {
            game: entrada.game,
            since: entrada.gameSince,
            icon: entrada.gameIcon,
            cover: entrada.gameCover,
          };
        } else {
          delete activity[entrada.userId];
        }
      }
      return { presence, activity };
    }),

  updatePresence: (entry) =>
    set((state) => {
      const { [entry.userId]: _semJogo, ...atividadeSemEste } = state.activity;
      /**
       * Quem ficou offline sai dos DOIS mapas: senao continuaria "jogando"
       * para sempre na tela dos outros depois de fechar o app.
       *
       * MENOS voce mesmo. Para os outros, OFFLINE quer dizer "foi embora";
       * para voce, quer dizer INVISIVEL — segue conectado, so aparece apagado.
       * Apagar a propria entrada fazia o seletor de status cair no padrao e
       * mostrar "Disponivel" um segundo depois de escolher "Invisivel".
       */
      const souEu = entry.userId === state.selfUserId;
      if (entry.status === "OFFLINE" && !souEu) {
        const { [entry.userId]: _gone, ...rest } = state.presence;
        return { presence: rest, activity: atividadeSemEste };
      }
      return {
        presence: { ...state.presence, [entry.userId]: entry.status },
        activity: entry.game
          ? {
              ...atividadeSemEste,
              [entry.userId]: {
                game: entry.game,
                since: entry.gameSince,
                icon: entry.gameIcon,
                cover: entry.gameCover,
              },
            }
          : atividadeSemEste,
      };
    }),

  syncVoice: (participants) =>
    set({
      voice: Object.fromEntries(participants.map((p) => [p.userId, p])),
    }),

  setMedia: (media) => set({ media }),
  setMediaConnected: (mediaConnected) => set({ mediaConnected }),
  setScreenShares: (screenShares) =>
    set((state) => ({
      screenShares,
      // Se o destaque saiu do ar, volta para o automatico em vez de ficar
      // apontando para uma transmissao que acabou.
      focusedShareUserId: screenShares.some(
        (share) => share.userId === state.focusedShareUserId,
      )
        ? state.focusedShareUserId
        : null,
    })),
  setLocalSharing: (localSharing, track) =>
    set({ localSharing, localShareTrack: localSharing ? (track ?? null) : null }),
  setSharePreset: (sharePreset) => set({ sharePreset }),
  setFocusedShare: (focusedShareUserId) => set({ focusedShareUserId }),
  setRoomControls: (roomControls) => set({ roomControls }),

  updateVoice: (participant) =>
    set((state) => {
      // channelId nulo e a forma de "saiu da voz"
      if (participant.channelId === null) {
        const { [participant.userId]: _gone, ...rest } = state.voice;
        // Se quem saiu fui eu — por qualquer motivo, inclusive ter sido
        // desconectado — o token nao serve mais.
        const leftMyself = participant.userId === state.selfUserId;
        return leftMyself
          ? { voice: rest, media: null, mediaConnected: false }
          : { voice: rest };
      }
      return {
        voice: { ...state.voice, [participant.userId]: participant },
      };
    }),

  seedMessages: (channelId, messages) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: mergeById(state.messages[channelId] ?? [], messages),
      },
    })),

  /**
   * Abrir um canal zera o nao lido dele. O contador so existe para chamar
   * atencao ao que voce ainda nao viu — manter o numero enquanto a conversa
   * esta na tela seria ruido.
   */
  setActiveChannel: (activeChannelId) =>
    set((state) => {
      if (!activeChannelId) return { activeChannelId };
      const { [activeChannelId]: _read, ...rest } = state.unread;
      return { activeChannelId, unread: rest };
    }),

  receiveMessage: (message, nonce) =>
    set((state) => {
      const current = state.messages[message.channelId] ?? [];
      // Reconcilia o envio otimista: substitui a linha pendente em vez de
      // duplicar a mensagem na tela de quem enviou.
      const withoutPending = nonce
        ? current.filter((item) => item.nonce !== nonce)
        : current;
      /**
       * Nao conta como nao lida a mensagem que voce esta vendo, nem a que voce
       * mesmo escreveu — inclusive de outra aba sua.
       */
      const isElsewhere = message.channelId !== state.activeChannelId;
      const isFromSomeoneElse = message.author.id !== state.selfUserId;
      const unread =
        isElsewhere && isFromSomeoneElse
          ? {
              ...state.unread,
              [message.channelId]: (state.unread[message.channelId] ?? 0) + 1,
            }
          : state.unread;

      return {
        messages: {
          ...state.messages,
          [message.channelId]: mergeById(withoutPending, [message]),
        },
        unread,
      };
    }),

  addPending: (message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [message.channelId]: [
          ...(state.messages[message.channelId] ?? []),
          message,
        ],
      },
    })),

  failPending: (channelId, nonce, error) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: (state.messages[channelId] ?? []).map((item) =>
          item.nonce === nonce ? { ...item, pending: false, failed: error } : item,
        ),
      },
    })),

  prependHistory: (channelId, messages, hasMore) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: mergeById(state.messages[channelId] ?? [], messages),
      },
      history: {
        ...state.history,
        [channelId]: { hasMore, loading: false },
      },
    })),

  setHistoryLoading: (channelId, loading) =>
    set((state) => ({
      history: {
        ...state.history,
        [channelId]: {
          hasMore: state.history[channelId]?.hasMore ?? true,
          loading,
        },
      },
    })),
}));

/* --------------------------------------------------------------------------
 * Seletores. Sempre devolvem valor primitivo ou referencia estavel — seletor
 * que cria array novo a cada render faz o Zustand re-renderizar em laco.
 * ------------------------------------------------------------------------ */

export function usePresenceStatus(userId: string): UserStatus {
  return useRealtimeStore((state) => state.presence[userId] ?? "OFFLINE");
}

export function useIsConnected(): boolean {
  return useRealtimeStore((state) => state.connectionStatus === "online");
}

export function useConnectionStatus(): ConnectionStatus {
  return useRealtimeStore((state) => state.connectionStatus);
}

export function useChannelMessages(channelId: string): ChatMessage[] {
  return useRealtimeStore(
    (state) => state.messages[channelId] ?? EMPTY_MESSAGES,
  );
}

export function useChannelHistory(channelId: string): ChannelHistory {
  return useRealtimeStore(
    (state) => state.history[channelId] ?? DEFAULT_HISTORY,
  );
}

/** Participantes de um canal de voz. O filtro mora no useMemo, nao no seletor. */
export function useVoiceParticipants(channelId: string): VoiceParticipant[] {
  const voice = useRealtimeStore((state) => state.voice);
  return useMemo(
    () => Object.values(voice).filter((p) => p.channelId === channelId),
    [voice, channelId],
  );
}

export function useUnreadCounts(): Record<string, number> {
  return useRealtimeStore((state) => state.unread);
}

export function useScreenShares(): RemoteScreenShare[] {
  return useRealtimeStore((state) => state.screenShares);
}

export function useMediaConnected(): boolean {
  return useRealtimeStore((state) => state.mediaConnected);
}

/** Estado de voz do proprio usuario — alimenta a barra de controles. */
export function useSelfVoice(): VoiceParticipant | null {
  const voice = useRealtimeStore((state) => state.voice);
  const selfUserId = useRealtimeStore((state) => state.selfUserId);
  return selfUserId ? (voice[selfUserId] ?? null) : null;
}
