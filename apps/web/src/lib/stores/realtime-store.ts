"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type {
  MediaGrant,
  MusicActivity,
  NaoLidasIniciais,
  PresenceEntry,
  PublicMessage,
  PublicReaction,
  PublicUser,
  UserStatus,
  VoiceParticipant,
} from "@aether/shared";
import type { Track } from "livekit-client";
import type { RemoteCamera, RemoteScreenShare } from "@/lib/voice/room";
import type { ConnectionStats } from "@/lib/voice/connection-stats";
import type { MediaDebug } from "@/lib/voice/media-debug";
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
   * Nivel de audio por usuario (0..1), atualizado ~11x/s enquanto voce esta na
   * call. So MODULA o glow de fala — "quem esta falando" continua em
   * `voice[id].speaking`. Mapa proprio, e nao campo em `voice`, para nao
   * re-renderizar toda a arvore de participantes a cada leitura: os cards leem
   * pelo seletor `useVoiceLevel(id)`, um numero, e so acordam se o SEU numero
   * mudar.
   */
  voiceLevels: Record<string, number>;
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
  /**
   * A INTENCAO de estar na call, que SOBREVIVE a uma queda de socket e a um
   * reload da aba (ver o comentario de `VOICE_INTENT_KEY`). O `clearVolatile`
   * nao a toca; so `sair()` explicito, um `voice:update` de saida propria ou um
   * despejo do servidor a apagam.
   */
  voiceIntent: { channelId: string } | null;
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
    /**
     * Identidades cujo audio de tela pode tocar (as que a pessoa aceitou
     * assistir). O audio de tela fica mudo ate entrar aqui — nada de ouvir a
     * tela de quem transmite sem ter pedido.
     */
    definirTelasOuvidas: (userIds: string[]) => void;
    /** volume de saida global (0..2) — multiplica tudo que chega; amplia acima de 100% */
    setOutputVolume: (volume: number) => void;
    /** troca a qualidade da transmissao ativa, sem reabrir o seletor de tela */
    setSharePreset: (preset: SharePresetId) => Promise<boolean>;
    /** liga/desliga a camera; `false` quando o dispositivo recusou */
    setCameraEnabled: (enabled: boolean, deviceId?: string) => Promise<boolean>;
    /**
     * Liga/desliga o RNNoise na faixa de mic ao vivo (botao do dock).
     * `false` quando nao ha faixa publicada — o botao fica desabilitado.
     */
    definirSupressaoAvancada: (ligado: boolean) => Promise<boolean>;
    /** forca do gate pela VAD do RNNoise (0..1), ao vivo */
    definirForcaSupressao: (forca: number) => void;
    /**
     * Reaplica as constraints nativas do mic (supressao nativa, eco, ganho)
     * lendo a preferencia atual. `false` se nao houver faixa ou se falhar.
     */
    reaplicarTratamentoNativo: () => Promise<boolean>;
    /**
     * Assina as estatisticas de conexao (ping, perda, regiao). Nada e medido
     * enquanto ninguem assina — o painel so monta quando aberto. Devolve o
     * cancelador.
     */
    subscribeConnectionStats: (
      cb: (stats: ConnectionStats) => void,
    ) => () => void;
    /**
     * Assina as estatisticas COMPLETAS (painel de Depuracao). Bem mais caro:
     * le o relatorio inteiro das duas conexoes a cada segundo, e por isso so
     * roda com a janela de depuracao aberta.
     */
    subscribeMediaDebug: (cb: (debug: MediaDebug) => void) => () => void;
  } | null;
  messages: Record<string, ChatMessage[]>;
  history: Record<string, ChannelHistory>;
  /**
   * Cor do cargo principal de cada membro do SERVIDOR ABERTO — userId -> hex.
   * Igual ao `voice`: e do servidor na tela, trocar de servidor troca o mapa
   * inteiro. Alimentado pelo `<MemberPanel>` (quem ja recebe `members`+`roles`
   * do SSR); o `<MessageGroup>` so LE, para o nome do autor no chat.
   */
  corPorMembro: Record<string, string>;
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

  /**
   * As conversas diretas conhecidas, `dmId -> a outra pessoa`.
   *
   * Existe para dar rosto e destino ao contador de nao-lidas de DM: sem isto o
   * `unread` teria a chave da conversa mas nada saberia dizer de quem e nem
   * para onde ir. Alimentado pelo `dm:list` na conexao e por cada DM que
   * chega. Sobrevive a troca de servidor, ao contrario do resto de `unread` —
   * conversa direta nao e de servidor nenhum.
   */
  conversasDm: Record<string, PublicUser>;

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
  setVoiceLevels: (levels: Record<string, number>) => void;
  /** grava/limpa a intencao de estar na call (e persiste em `sessionStorage`) */
  setVoiceIntent: (channelId: string | null) => void;
  /** define so a MINHA ocupacao — usado ao religar a call apos um reconnect */
  setSelfVoice: (participant: VoiceParticipant) => void;
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
  removerMensagem: (messageId: string) => void;
  /**
   * As nao lidas salvas no servidor (`read:state`), que chegam a cada conexao.
   * SUBSTITUEM o contador em memoria: o servidor e a fonte de verdade.
   */
  hidratarNaoLidas: (estado: NaoLidasIniciais) => void;
  /** A conversa foi lida em outra aba ou aparelho (`read:updated`). */
  marcarLidaAqui: (conversationId: string) => void;
  /** Substitui o mapa inteiro — chamado pelo `<MemberPanel>` do servidor aberto. */
  definirCoresDeMembro: (cores: Record<string, string>) => void;
  receiveMessage: (
    message: PublicMessage,
    nonce: string | null,
    serverId: string | null,
  ) => void;
  /** substitui a lista de conversas diretas conhecidas (vem do `dm:list`) */
  hidratarConversasDm: (conversas: { id: string; outro: PublicUser }[]) => void;
  /** garante que uma conversa direta esta no mapa (uma DM acabou de chegar) */
  registrarConversaDm: (dmId: string, outro: PublicUser) => void;
  addPending: (message: ChatMessage) => void;
  failPending: (channelId: string, nonce: string, error: string) => void;
  /**
   * Volta uma mensagem FALHADA pro estado "enviando" — quem chama e quem
   * reemite `message:send` de verdade (o store so mexe no estado local, nao
   * fala com o socket). Antes disto uma falha de envio nao tinha volta: o
   * campo ja tinha sido limpo, e a unica saida era reescrever a mensagem do
   * zero.
   */
  retrySending: (channelId: string, nonce: string) => void;
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

/**
 * A INTENCAO de estar numa call — separada de `selfVoice`/`media`.
 *
 * `selfVoice` e `media` sao volateis: caem no `clearVolatile` quando o socket
 * cai, porque o token de midia morreu e nao sabemos mais quem esta onde. Mas a
 * pessoa nao "saiu da call" so porque a rede piscou — ela ainda QUER estar la.
 *
 * Esse desejo e o que o `RealtimeProvider` usa para reemitir `voice:join` no
 * reconnect (o gateway tirou a ocupacao no disconnect, e nada a recolocava), e
 * o que um reload da aba precisa reencontrar — o OAuth do Spotify no desktop
 * navega a janela inteira, e sem isto a call sumia de vez. Por isso vai para o
 * `sessionStorage`: sobrevive ao reload, morre ao fechar a aba.
 */
const VOICE_INTENT_KEY = "aether:voice-intent";

function lerVoiceIntent(): { channelId: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const cru = window.sessionStorage.getItem(VOICE_INTENT_KEY);
    if (!cru) return null;
    const valor = JSON.parse(cru) as { channelId?: unknown };
    return typeof valor.channelId === "string"
      ? { channelId: valor.channelId }
      : null;
  } catch {
    return null;
  }
}

function gravarVoiceIntent(intent: { channelId: string } | null): void {
  if (typeof window === "undefined") return;
  try {
    if (intent) {
      window.sessionStorage.setItem(VOICE_INTENT_KEY, JSON.stringify(intent));
    } else {
      window.sessionStorage.removeItem(VOICE_INTENT_KEY);
    }
  } catch {
    // Modo privado ou storage cheio: o reconnect na MESMA aba ainda funciona
    // pela copia em memoria; so o religa-apos-reload e que se perde.
  }
}

/**
 * Ordem cronologica estavel.
 *
 * `createdAt` e ISO 8601 em UTC: a ordem lexicografica dos bytes JA e a
 * cronologica, entao `<` basta. O `id` (cuid) so desempata.
 *
 * NAO usa `localeCompare`: ele carrega a colacao do Intl e e ~7x mais lento
 * (medido). Numa lista de mil mensagens isso e chamado milhares de vezes por
 * mensagem que chega — e ninguem precisa de regra de idioma para ordenar
 * carimbo de data.
 */
function compararMensagens(a: ChatMessage, b: ChatMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Ordena por data e remove duplicata por id — historico e socket se sobrepoem. */
function mergeById(
  current: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  /**
   * CAMINHO RAPIDO: uma mensagem nova, que nao existe na lista e e mais recente
   * que a ultima. E o caso esmagadoramente comum — alguem mandou algo agora.
   *
   * Sem ele, CADA mensagem recebida remontava o Map inteiro e reordenava a
   * lista inteira: trabalho O(n log n) num handler de socket, com a thread
   * principal travada, para acrescentar um item no fim.
   */
  if (incoming.length === 1 && current.length > 0) {
    const nova = incoming[0]!;
    const ultima = current[current.length - 1]!;
    if (
      compararMensagens(ultima, nova) < 0 &&
      !current.some((m) => m.id === nova.id)
    ) {
      return [...current, nova];
    }
  }

  const byId = new Map<string, ChatMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) {
    const anterior = byId.get(message.id);
    byId.set(message.id, anterior ? { ...anterior, ...message } : message);
  }
  return [...byId.values()].sort(compararMensagens);
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
  voiceLevels: {},
  selfVoice: null,
  voiceIntent: lerVoiceIntent(),
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
  corPorMembro: {},
  history: {},
  activeChannelId: null,
  unread: {},
  serverDoCanal: {},
  conversasDm: {},

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
            /**
             * `unread` e `serverDoCanal` NAO zeram mais (P1-3). Zeravam porque
             * o cliente so conhecia a arvore do servidor aberto; agora o
             * `read:state` traz as nao lidas e a origem de todo canal visivel,
             * e trocar de servidor apagaria o contador do icone dos outros.
             */
            activeChannelId: null,
            serverId,
            presence: {},
            activity: {},
            listening: {},
            /**
             * `voice` zera porque os participantes sao daquele servidor.
             *
             * `selfVoice`, `voiceIntent`, `media` e `mediaConnected` NAO: sao
             * a minha chamada, que nao pertence a servidor nenhum. Zera-los
             * aqui era o que fazia trocar de servidor derrubar a call.
             */
            voice: {},
            voiceLevels: {},
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
      voiceLevels: {},
      // O socket caiu: a chamada caiu junto, e ai limpar a MINHA voz esta
      // certo — diferente de so ter trocado de servidor.
      //
      // `voiceIntent` NAO entra aqui de proposito: e o desejo de estar na
      // call, nao o estado dela. Quando o socket voltar, o `RealtimeProvider`
      // le esse campo e reemite `voice:join` — sem ele, a call sumia a cada
      // piscada de rede.
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
      if (!eu) return { voice: mapa };
      if (eu.channelId && state.voiceIntent?.channelId !== eu.channelId) {
        gravarVoiceIntent({ channelId: eu.channelId });
      }
      return {
        voice: mapa,
        selfVoice: eu,
        ...(eu.channelId ? { voiceIntent: { channelId: eu.channelId } } : null),
      };
    }),

  setMedia: (media) => set({ media }),
  setMediaConnected: (mediaConnected) => set({ mediaConnected }),
  setVoiceLevels: (voiceLevels) => set({ voiceLevels }),

  setVoiceIntent: (channelId) =>
    set(() => {
      const voiceIntent = channelId ? { channelId } : null;
      gravarVoiceIntent(voiceIntent);
      return { voiceIntent };
    }),

  setSelfVoice: (selfVoice) => set({ selfVoice }),
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
    set({
      localSharing,
      localShareTrack: localSharing ? (track ?? null) : null,
    }),
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
        // desconectado ou outra aba ter clicado em desconectar — o token nao
        // serve mais e a intencao acabou junto.
        //
        // O eco atrasado da troca de servidor NAO cai aqui: o gateway usa
        // `socket.to(...)` para nao mandar a propria saida de volta a quem
        // moveu a call (ver `handlers/voice.ts`).
        const leftMyself = participant.userId === state.selfUserId;
        if (leftMyself) gravarVoiceIntent(null);
        return leftMyself
          ? {
              voice: rest,
              selfVoice: null,
              voiceIntent: null,
              media: null,
              mediaConnected: false,
            }
          : { voice: rest };
      }
      const souEu = participant.userId === state.selfUserId;
      // Fui movido de canal (ou reentrei): a intencao acompanha o canal novo,
      // para um reload religar no lugar certo.
      if (souEu && state.voiceIntent?.channelId !== participant.channelId) {
        gravarVoiceIntent({ channelId: participant.channelId });
      }
      return {
        voice: { ...state.voice, [participant.userId]: participant },
        ...(souEu
          ? {
              selfVoice: participant,
              voiceIntent: { channelId: participant.channelId },
            }
          : null),
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

  /**
   * Some com a mensagem — soft delete, mesma ideia de `aplicarReacoes`: o
   * evento so traz o id, entao percorre as conversas carregadas.
   *
   * Duas coisas mudam, nao so uma: a propria mensagem sai da lista, E toda
   * mensagem que a tinha como resposta ganha "apagada" na hora — sem isto a
   * referencia continuaria mostrando o texto antigo ate a pagina recarregar.
   */
  removerMensagem: (messageId) =>
    set((state) => {
      const proximas: Record<string, ChatMessage[]> = {};
      let mudou = false;
      for (const [conversa, lista] of Object.entries(state.messages)) {
        let mudouAqui = false;
        const nova: ChatMessage[] = [];
        for (const m of lista) {
          if (m.id === messageId) {
            mudouAqui = true;
            continue;
          }
          if (m.replyTo?.id === messageId && !m.replyTo.apagada) {
            mudouAqui = true;
            nova.push({ ...m, replyTo: { ...m.replyTo, apagada: true, trecho: "" } });
            continue;
          }
          nova.push(m);
        }
        if (mudouAqui) mudou = true;
        proximas[conversa] = mudouAqui ? nova : lista;
      }
      return mudou ? { messages: proximas } : {};
    }),

  hidratarNaoLidas: ({ naoLidas, serverDoCanal }) =>
    set((state) => {
      /**
       * A conversa aberta fica de fora: quem esta olhando para ela ja leu, e
       * a tela vai marcar no servidor logo em seguida. Contar ali faria o
       * numero piscar e sumir.
       */
      const { [state.activeChannelId ?? ""]: _aberta, ...resto } = naoLidas;
      return {
        unread: resto,
        serverDoCanal: { ...state.serverDoCanal, ...serverDoCanal },
      };
    }),

  marcarLidaAqui: (conversationId) =>
    set((state) => {
      if (!state.unread[conversationId]) return {};
      const { [conversationId]: _lida, ...rest } = state.unread;
      return { unread: rest };
    }),

  definirCoresDeMembro: (cores) => set({ corPorMembro: cores }),

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
              [message.conversationId]:
                (state.unread[message.conversationId] ?? 0) + 1,
            }
          : state.unread;

      /**
       * Conversa direta (`serverId` nulo) de outra pessoa: registra a conversa
       * pelo autor. E o que da rosto ao contador de nao-lidas — e, se a
       * primeira DM chegou antes do `dm:list`, e por aqui que a conversa
       * aparece. A minha propria mensagem nao serve: o "outro" dela sou eu.
       */
      const conversasDm =
        serverId === null && isFromSomeoneElse && !state.conversasDm[message.conversationId]
          ? {
              ...state.conversasDm,
              [message.conversationId]: message.author,
            }
          : state.conversasDm;

      return {
        messages: {
          ...state.messages,
          [message.conversationId]: mergeById(withoutPending, [message]),
        },
        unread,
        conversasDm,
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

  hidratarConversasDm: (conversas) =>
    set((state) => {
      const proximo = { ...state.conversasDm };
      for (const conversa of conversas) proximo[conversa.id] = conversa.outro;
      return { conversasDm: proximo };
    }),

  registrarConversaDm: (dmId, outro) =>
    set((state) =>
      state.conversasDm[dmId]
        ? {}
        : { conversasDm: { ...state.conversasDm, [dmId]: outro } },
    ),

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
          item.nonce === nonce
            ? { ...item, pending: false, failed: error }
            : item,
        ),
      },
    })),

  retrySending: (channelId, nonce) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: (state.messages[channelId] ?? []).map((item) =>
          item.nonce === nonce
            ? { ...item, pending: true, failed: undefined }
            : item,
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

/** Uma conversa direta como as telas de notificacao a consomem. */
export interface ConversaDmNaoLida {
  dmId: string;
  outro: PublicUser;
  naoLidas: number;
}

/**
 * As conversas diretas conhecidas, com a contagem de nao-lidas de cada uma,
 * as com pendencia no topo.
 *
 * DERIVADO de `unread` + `conversasDm`, pelo mesmo motivo do `useUnreadByServer`:
 * um segundo contador em paralelo acabaria discordando do que zera quando a
 * conversa abre (`setActiveChannel`).
 *
 * MESMO padrao do `useVoiceParticipants`: seleciona os mapas crus (refs
 * estaveis) e deriva a lista com `useMemo`. `useShallow` sobre uma lista de
 * objetos novos a cada calculo nunca da igual — e um laco de render infinito.
 */
export function useConversasDm(): ConversaDmNaoLida[] {
  const conversasDm = useRealtimeStore((state) => state.conversasDm);
  const unread = useRealtimeStore((state) => state.unread);
  return useMemo(
    () =>
      Object.entries(conversasDm)
        .map(([dmId, outro]) => ({
          dmId,
          outro,
          naoLidas: unread[dmId] ?? 0,
        }))
        .sort((a, b) => b.naoLidas - a.naoLidas),
    [conversasDm, unread],
  );
}

/** Quantas CONVERSAS diretas tem mensagem nao lida — o numero do badge. */
export function useTotalDmNaoLido(): number {
  return useRealtimeStore(
    (state) =>
      Object.keys(state.conversasDm).filter((id) => (state.unread[id] ?? 0) > 0)
        .length,
  );
}

/**
 * O `dmId` para abrir direto quando ha EXATAMENTE uma conversa nao lida — o
 * clique no trilho leva na mensagem em vez de na lista. `null` quando ha zero
 * ou mais de uma (ai o destino e a tela de Amigos).
 */
export function useDmParaAbrir(): string | null {
  return useRealtimeStore((state) => {
    const comNaoLida = Object.keys(state.conversasDm).filter(
      (id) => (state.unread[id] ?? 0) > 0,
    );
    return comNaoLida.length === 1 ? comNaoLida[0]! : null;
  });
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

/**
 * Nivel de audio de um usuario (0..1), para modular o glow de fala.
 *
 * Devolve um numero: o card so re-renderiza quando O SEU nivel muda, e nao a
 * cada tick do poll. `0` quando nao ha medida — o card cai na animacao
 * `aether-breathe`.
 */
export function useVoiceLevel(userId: string): number {
  return useRealtimeStore((state) => state.voiceLevels[userId] ?? 0);
}
