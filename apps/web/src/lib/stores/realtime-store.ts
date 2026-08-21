"use client";

import { useMemo } from "react";
import { create } from "zustand";
import type {
  PresenceEntry,
  PublicMessage,
  UserStatus,
  VoiceParticipant,
} from "@aether/shared";

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
  voice: Record<string, VoiceParticipant>;
  messages: Record<string, ChatMessage[]>;
  history: Record<string, ChannelHistory>;

  setConnectionStatus: (status: ConnectionStatus) => void;
  setSelfUserId: (userId: string) => void;
  setError: (error: string | null) => void;
  setVoiceError: (error: string | null) => void;
  /** troca de servidor zera tudo que era daquele servidor */
  enterServer: (serverId: string) => void;
  clearVolatile: () => void;

  syncPresence: (entries: PresenceEntry[]) => void;
  updatePresence: (entry: PresenceEntry) => void;

  syncVoice: (participants: VoiceParticipant[]) => void;
  updateVoice: (participant: VoiceParticipant) => void;

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
  voice: {},
  messages: {},
  history: {},

  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setSelfUserId: (selfUserId) => set({ selfUserId }),
  setError: (error) => set({ error }),
  setVoiceError: (voiceError) => set({ voiceError }),

  enterServer: (serverId) =>
    set((state) =>
      state.serverId === serverId
        ? { serverId }
        : { serverId, presence: {}, voice: {}, messages: {}, history: {} },
    ),

  /**
   * Sem conexao nao sabemos quem esta online nem quem esta em call; manter o
   * ultimo estado na tela seria apresentar como atual algo que nao e.
   * Mensagens ficam: elas sao historico, nao estado vivo.
   */
  clearVolatile: () => set({ presence: {}, voice: {} }),

  syncPresence: (entries) =>
    set({
      presence: Object.fromEntries(entries.map((e) => [e.userId, e.status])),
    }),

  updatePresence: (entry) =>
    set((state) => {
      if (entry.status === "OFFLINE") {
        const { [entry.userId]: _gone, ...rest } = state.presence;
        return { presence: rest };
      }
      return {
        presence: { ...state.presence, [entry.userId]: entry.status },
      };
    }),

  syncVoice: (participants) =>
    set({
      voice: Object.fromEntries(participants.map((p) => [p.userId, p])),
    }),

  updateVoice: (participant) =>
    set((state) => {
      // channelId nulo e a forma de "saiu da voz"
      if (participant.channelId === null) {
        const { [participant.userId]: _gone, ...rest } = state.voice;
        return { voice: rest };
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

  receiveMessage: (message, nonce) =>
    set((state) => {
      const current = state.messages[message.channelId] ?? [];
      // Reconcilia o envio otimista: substitui a linha pendente em vez de
      // duplicar a mensagem na tela de quem enviou.
      const withoutPending = nonce
        ? current.filter((item) => item.nonce !== nonce)
        : current;
      return {
        messages: {
          ...state.messages,
          [message.channelId]: mergeById(withoutPending, [message]),
        },
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

/** Estado de voz do proprio usuario — alimenta a barra de controles. */
export function useSelfVoice(): VoiceParticipant | null {
  const voice = useRealtimeStore((state) => state.voice);
  const selfUserId = useRealtimeStore((state) => state.selfUserId);
  return selfUserId ? (voice[selfUserId] ?? null) : null;
}
