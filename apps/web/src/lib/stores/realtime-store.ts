"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type {
  MediaGrant,
  MusicActivity,
  PresenceEntry,
  PublicMessage,
  PublicReaction,
  UserStatus,
  VoiceParticipant,
} from "@aether/shared";
import type { Track } from "livekit-client";
import type { RemoteCamera, RemoteScreenShare } from "@/lib/voice/room";
import type { ConnectionStats } from "@/lib/voice/connection-stats";
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
  /**
   * Teste de microfone ATIVO — "ouvindo a propria voz".
   *
   * E um estado global, e nao so da tela de Configuracoes, porque o redesign
   * mostra uma faixa vermelha no palco enquanto ele roda ("ninguem na call
   * recebe este audio"). O audio NAO e transmitido: o medidor abre um stream
   * local proprio (`lib/voice/mic-level.ts`).
   *
   * Volatil: cai junto com o socket (`clearVolatile`).
   */
  micTest: boolean;

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
  /**
   * O que cada pessoa esta ouvindo no Spotify agora. Mapa SEPARADO do `activity`
   * porque musica e jogo sao independentes — da para as duas coisas ao mesmo
   * tempo. Populado pelo mesmo `PresenceEntry` (`listening`), pelo poller do
   * gateway.
   */
  listening: Record<string, MusicActivity>;
  voice: Record<string, VoiceParticipant>;
  /**
   * A MINHA ocupacao de voz — separada do mapa acima, e nao derivada dele.
   *
   * O mapa `voice` e do servidor que esta ABERTO na tela: trocar de servidor
   * troca o mapa inteiro. Minha chamada nao tem nada a ver com isso. Enquanto
   * as duas coisas moravam no mesmo lugar, sair do servidor para ver os amigos
   * apagava a minha entrada, a sessao de midia via o canal sumir e DESLIGAVA A
   * CHAMADA — navegar encerrava a call.
   *
   * Aqui ela sobrevive a navegacao. So sai quando eu de fato saio da voz, ou
   * quando o socket cai (`clearVolatile`).
   */
  selfVoice: VoiceParticipant | null;
  /** credenciais do SFU, validas so enquanto voce esta na call */
  media: MediaGrant | null;
  /** a sala de midia esta conectada de fato (nao e o mesmo que estar no canal) */
  mediaConnected: boolean;
  /** compartilhamentos de tela recebidos na sala */
  screenShares: RemoteScreenShare[];
  /**
   * Cameras recebidas na sala, SEPARADAS dos compartilhamentos.
   *
   * Sao dois videos com destinos diferentes: camera vai no bloco da pessoa,
   * tela vai no palco. Guardar juntos obrigaria todo consumidor a filtrar, e
   * bastaria um esquecer para a camera de alguem virar transmissao.
   */
  cameras: RemoteCamera[];
  /** o proprio usuario esta transmitindo */
  localSharing: boolean;
  /** perfil de qualidade da MINHA transmissao — a interface marca o ativo */
  sharePreset: SharePresetId;
  /** faixa local, para voce conferir o que esta enviando */
  localShareTrack: Track | null;
  /** a propria camera, para voce se ver no proprio bloco */
  localCameraTrack: Track | null;
  /** qual compartilhamento esta em destaque; null = o primeiro disponivel */
  focusedShareUserId: string | null;
  /**
   * Transmissoes que voce ESCOLHEU assistir.
   *
   * Antes, a tela de quem transmitia abria sozinha para todo mundo no canal.
   * Isso e invasivo em dois sentidos: rouba a atencao de quem estava fazendo
   * outra coisa, e comeca a baixar video sem ninguem ter pedido — numa
   * conexao limitada isso e um custo real e involuntario.
   *
   * A propria transmissao nunca precisa entrar aqui: ver o que voce mesmo esta
   * enviando e conferencia, nao intromissao.
   */
  watchedShares: string[];
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
    /** liga/desliga a camera; `false` quando o dispositivo recusou */
    setCameraEnabled: (enabled: boolean, deviceId?: string) => Promise<boolean>;
    /**
     * Liga/desliga o RNNoise na faixa de mic ao vivo (botao do dock).
     * `false` quando nao ha faixa publicada — o botao fica desabilitado.
     */
    definirSupressaoAvancada: (ligado: boolean) => Promise<boolean>;
    /**
     * Assina as estatisticas de conexao (ping, perda, regiao). Nada e medido
     * enquanto ninguem assina — o painel so monta quando aberto. Devolve o
     * cancelador.
     */
    subscribeConnectionStats: (
      cb: (stats: ConnectionStats) => void,
    ) => () => void;
  } | null;
  messages: Record<string, ChatMessage[]>;
  history: Record<string, ChannelHistory>;
  /** canal aberto agora — mensagem que chega nele ja nasce lida */
  activeChannelId: string | null;
  /** mensagens nao lidas por canal */
  unread: Record<string, number>;
  /**
   * De qual servidor e cada canal, APRENDIDO das mensagens que chegam.
   *
   * O cliente so conhece a arvore do servidor que esta aberto; para somar as
   * nao lidas por servidor e preciso saber a origem de canais que ele nunca
   * abriu. O gateway manda `serverId` junto de cada mensagem, e o mapa vai
   * sendo preenchido.
   *
   * Conversa direta nao entra: ela nao pertence a servidor nenhum.
   */
  serverDoCanal: Record<string, string>;

  setConnectionStatus: (status: ConnectionStatus) => void;
  setSelfUserId: (userId: string) => void;
  setError: (error: string | null) => void;
  setVoiceError: (error: string | null) => void;
  setMicTest: (ativo: boolean) => void;
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
  setCameras: (cameras: RemoteCamera[]) => void;
  setLocalSharing: (sharing: boolean, track?: Track | null) => void;
  setLocalCamera: (track: Track | null) => void;
  setSharePreset: (preset: SharePresetId) => void;
  setFocusedShare: (userId: string | null) => void;
  /** aceita assistir a transmissao de alguem */
  watchShare: (userId: string) => void;
  /** para de assistir — volta a pedir permissao se ela recomecar */
  unwatchShare: (userId: string) => void;
  setRoomControls: (controls: RealtimeState["roomControls"]) => void;

  seedMessages: (channelId: string, messages: PublicMessage[]) => void;
  aplicarReacoes: (messageId: string, reactions: PublicReaction[]) => void;
  receiveMessage: (
    message: PublicMessage,
    nonce: string | null,
    serverId: string | null,
  ) => void;
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
  micTest: false,
  presence: {},
  activity: {},
  listening: {},
  voice: {},
  selfVoice: null,
  media: null,
  mediaConnected: false,
  screenShares: [],
  cameras: [],
  localSharing: false,
  sharePreset: DEFAULT_PRESET,
  localShareTrack: null,
  localCameraTrack: null,
  focusedShareUserId: null,
  watchedShares: [],
  roomControls: null,
  messages: {},
  history: {},
  activeChannelId: null,
  unread: {},
  serverDoCanal: {},

  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setSelfUserId: (selfUserId) => set({ selfUserId }),
  setError: (error) => set({ error }),
  setVoiceError: (voiceError) => set({ voiceError }),
  setMicTest: (micTest) => set({ micTest }),

  enterServer: (serverId) =>
    set((state) =>
      state.serverId === serverId
        ? { serverId }
        : {
            unread: {},
            serverDoCanal: {},
            activeChannelId: null,
            serverId,
            presence: {},
            activity: {},
            listening: {},
            /**
             * `voice` zera porque os participantes sao daquele servidor.
             *
             * `selfVoice`, `media` e `mediaConnected` NAO: sao a minha
             * chamada, que nao pertence a servidor nenhum. Zera-los aqui era
             * o que fazia trocar de servidor derrubar a call.
             */
            voice: {},
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
      listening: {},
      voice: {},
      // O socket caiu: a chamada caiu junto, e ai limpar a MINHA voz esta
      // certo — diferente de so ter trocado de servidor.
      selfVoice: null,
      media: null,
      mediaConnected: false,
      screenShares: [],
      cameras: [],
      localSharing: false,
      localShareTrack: null,
      localCameraTrack: null,
      focusedShareUserId: null,
      watchedShares: [],
      // O teste de microfone abre um stream local proprio; sem socket nao ha
      // por que segurar o dispositivo aberto.
      micTest: false,
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
      listening: Object.fromEntries(
        entries
          .filter((e): e is PresenceEntry & { listening: MusicActivity } =>
            Boolean(e.listening),
          )
          .map((e) => [e.userId, e.listening]),
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
      const listening = { ...state.listening };
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
        if (entrada.listening) listening[entrada.userId] = entrada.listening;
        else delete listening[entrada.userId];
      }
      return { presence, activity, listening };
    }),

  updatePresence: (entry) =>
    set((state) => {
      const { [entry.userId]: _semJogo, ...atividadeSemEste } = state.activity;
      const { [entry.userId]: _semMusica, ...ouvindoSemEste } = state.listening;
      /**
       * Quem ficou offline sai dos TRES mapas: senao continuaria "jogando" ou
       * "ouvindo" para sempre na tela dos outros depois de fechar o app.
       *
       * MENOS voce mesmo. Para os outros, OFFLINE quer dizer "foi embora";
       * para voce, quer dizer INVISIVEL — segue conectado, so aparece apagado.
       * Apagar a propria entrada fazia o seletor de status cair no padrao e
       * mostrar "Disponivel" um segundo depois de escolher "Invisivel".
       */
      const souEu = entry.userId === state.selfUserId;
      if (entry.status === "OFFLINE" && !souEu) {
        const { [entry.userId]: _gone, ...rest } = state.presence;
        return {
          presence: rest,
          activity: atividadeSemEste,
          listening: ouvindoSemEste,
        };
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
        listening: entry.listening
          ? { ...ouvindoSemEste, [entry.userId]: entry.listening }
          : ouvindoSemEste,
      };
    }),

  syncVoice: (participants) =>
    set((state) => {
      const mapa = Object.fromEntries(participants.map((p) => [p.userId, p]));
      /**
       * A minha entrada so e atualizada se eu aparecer NESTA sincronizacao.
       * Nao aparecer nao quer dizer que sai da voz — quer dizer que estou em
       * outro servidor. Apagar aqui era metade do bug.
       */
      const eu = state.selfUserId ? mapa[state.selfUserId] : undefined;
      return eu ? { voice: mapa, selfVoice: eu } : { voice: mapa };
    }),

  setMedia: (media) => set({ media }),
  setMediaConnected: (mediaConnected) => set({ mediaConnected }),
  setCameras: (cameras) => set({ cameras }),
  setLocalCamera: (localCameraTrack) => set({ localCameraTrack }),

  setScreenShares: (screenShares) =>
    set((state) => ({
      screenShares,
      /**
       * Quem parou de transmitir sai da lista de assistidos. Sem isto, aceitar
       * uma vez valeria para sempre: a pessoa recomecaria a transmitir noutro
       * dia e a tela dela abriria sozinha de novo — que e exatamente o
       * comportamento que estamos removendo.
       */
      watchedShares: state.watchedShares.filter((id) =>
        screenShares.some((share) => share.userId === id),
      ),
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

  watchShare: (userId) =>
    set((state) =>
      state.watchedShares.includes(userId)
        ? {}
        : { watchedShares: [...state.watchedShares, userId] },
    ),

  unwatchShare: (userId) =>
    set((state) => ({
      watchedShares: state.watchedShares.filter((id) => id !== userId),
    })),
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
          ? { voice: rest, selfVoice: null, media: null, mediaConnected: false }
          : { voice: rest };
      }
      const souEu = participant.userId === state.selfUserId;
      return {
        voice: { ...state.voice, [participant.userId]: participant },
        ...(souEu ? { selfVoice: participant } : null),
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

  /**
   * Troca as reacoes de UMA mensagem, onde quer que ela esteja.
   *
   * Percorre as conversas em vez de receber a conversa junto: o evento so traz
   * `messageId`, e o cliente pode ter varias abertas em memoria. Sao dezenas
   * de mensagens por conversa e um punhado de conversas — mais barato que
   * carregar o cliente de saber a origem de cada id.
   */
  aplicarReacoes: (messageId, reactions) =>
    set((state) => {
      const proximas: Record<string, ChatMessage[]> = {};
      let mudou = false;
      for (const [conversa, lista] of Object.entries(state.messages)) {
        const indice = lista.findIndex((m) => m.id === messageId);
        if (indice === -1) {
          proximas[conversa] = lista;
          continue;
        }
        mudou = true;
        //  em vez de indexar o array copiado: o TypeScript nao sabe que
        // o indice existe, e um  esconderia justamente o caso que importa.
        proximas[conversa] = lista.map((m) =>
          m.id === messageId ? { ...m, reactions } : m,
        );
      }
      // Mensagem que nao esta carregada aqui: nada a fazer, e devolver o
      // mesmo objeto evita re-render de tudo a toa.
      return mudou ? { messages: proximas } : {};
    }),

  receiveMessage: (message, nonce, serverId) =>
    set((state) => {
      const current = state.messages[message.conversationId] ?? [];
      // Reconcilia o envio otimista: substitui a linha pendente em vez de
      // duplicar a mensagem na tela de quem enviou.
      const withoutPending = nonce
        ? current.filter((item) => item.nonce !== nonce)
        : current;
      /**
       * Nao conta como nao lida a mensagem que voce esta vendo, nem a que voce
       * mesmo escreveu — inclusive de outra aba sua.
       */
      const isElsewhere = message.conversationId !== state.activeChannelId;
      const isFromSomeoneElse = message.author.id !== state.selfUserId;
      const unread =
        isElsewhere && isFromSomeoneElse
          ? {
              ...state.unread,
              [message.conversationId]: (state.unread[message.conversationId] ?? 0) + 1,
            }
          : state.unread;

      return {
        messages: {
          ...state.messages,
          [message.conversationId]: mergeById(withoutPending, [message]),
        },
        unread,
        /**
         * O mapa e alimentado SEMPRE, mesmo quando a mensagem nao conta como
         * nao lida. Aprender a origem do canal enquanto voce olha para ele e o
         * que faz o contador funcionar quando voce sair dali.
         */
        serverDoCanal: serverId
          ? { ...state.serverDoCanal, [message.conversationId]: serverId }
          : state.serverDoCanal,
      };
    }),

  addPending: (message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [message.conversationId]: [
          ...(state.messages[message.conversationId] ?? []),
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

/** O que a pessoa esta ouvindo no Spotify agora, ou `null`. */
export function useListening(userId: string): MusicActivity | null {
  return useRealtimeStore((state) => state.listening[userId] ?? null);
}

export function useIsConnected(): boolean {
  return useRealtimeStore((state) => state.connectionStatus === "online");
}

/** Teste de microfone ativo ("ouvindo a propria voz"). */
export function useMicTest(): boolean {
  return useRealtimeStore((state) => state.micTest);
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

/**
 * Nao lidas somadas por SERVIDOR, para o contador no icone do trilho.
 *
 * DERIVADO de `unread`, e nao um segundo contador mantido em paralelo. Um
 * contador proprio precisaria ser decrementado toda vez que um canal fosse
 * lido, e bastaria um caminho esquecer para o numero no icone passar a
 * discordar da barra lateral — e numero de notificacao que nao zera e pior do
 * que numero nenhum.
 *
 * `useShallow` porque o objeto e novo a cada calculo: sem ele, todo evento da
 * store re-renderizaria o trilho inteiro.
 */
export function useUnreadByServer(): Record<string, number> {
  return useRealtimeStore(
    useShallow((state) => {
      const total: Record<string, number> = {};
      for (const [channelId, quantas] of Object.entries(state.unread)) {
        const serverId = state.serverDoCanal[channelId];
        // Sem origem conhecida = conversa direta, ou canal de que ainda nao
        // chegou mensagem nenhuma nesta sessao. Nao pertence a servidor algum.
        if (!serverId) continue;
        total[serverId] = (total[serverId] ?? 0) + quantas;
      }
      return total;
    }),
  );
}

export function useScreenShares(): RemoteScreenShare[] {
  return useRealtimeStore((state) => state.screenShares);
}

export function useMediaConnected(): boolean {
  return useRealtimeStore((state) => state.mediaConnected);
}

/** Estado de voz do proprio usuario — alimenta a barra de controles. */
/**
 * A minha ocupacao de voz.
 *
 * Le o campo proprio, e nao `voice[meuId]`: o mapa e do servidor aberto na
 * tela, e a minha chamada nao pertence a servidor nenhum. Derivar do mapa era
 * o que fazia a call morrer ao navegar.
 */
export function useSelfVoice(): VoiceParticipant | null {
  return useRealtimeStore((state) => state.selfVoice);
}
