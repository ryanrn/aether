import type {
  PublicMessage,
  PublicUser,
  UserStatus,
  VoiceParticipant,
  VoiceState,
} from "./types";

/**
 * Contratos dos eventos de WebSocket — o vocabulario entre o app web e o
 * gateway. Ficam aqui, e nao dentro do gateway, porque os dois lados precisam
 * concordar: se um mudar o formato sozinho, o outro para de compilar em vez de
 * quebrar em producao.
 *
 * Convencao de nome: `dominio:acao`. Eventos do cliente para o servidor levam
 * um ack tipado quando a resposta importa (entrar em servidor pode falhar);
 * eventos do servidor para o cliente sao sempre notificacao, sem resposta.
 */

/** Presenca efetiva de um usuario — o que o gateway sabe, nao o que o banco guarda. */
export interface PresenceEntry {
  userId: string;
  status: UserStatus;
}

export interface ReadyPayload {
  user: PublicUser;
  /** relogio do servidor: o cliente usa para nao confiar no relogio local */
  serverTime: number;
}

export type JoinServerAck =
  | { ok: true; presence: PresenceEntry[] }
  | { ok: false; error: string };

/** Quantas mensagens o historico devolve por pagina. */
export const MESSAGE_PAGE_SIZE = 50;

export type SendMessageAck =
  | { ok: true; message: PublicMessage }
  | { ok: false; error: string };

export type MessageHistoryAck =
  | { ok: true; messages: PublicMessage[]; hasMore: boolean }
  | { ok: false; error: string };

export type VoiceJoinAck =
  | { ok: true; participants: VoiceParticipant[] }
  | { ok: false; error: string };

export interface ServerToClientEvents {
  /** primeiro evento apos o handshake: confirma quem o gateway achou que voce e */
  ready: (payload: ReadyPayload) => void;
  /** estado completo de presenca de um servidor, ao entrar */
  "presence:sync": (payload: {
    serverId: string;
    entries: PresenceEntry[];
  }) => void;
  /**
   * Mensagem nova no canal. Vai para a sala do canal, entao so chega a quem
   * tem VIEW_CHANNEL — a checagem aconteceu quando o socket entrou na sala.
   *
   * O `nonce` volta junto para quem enviou reconciliar a mensagem otimista
   * que ja esta na tela, em vez de duplica-la.
   */
  "message:new": (payload: {
    message: PublicMessage;
    nonce: string | null;
  }) => void;
  /** estado completo de voz do servidor, ao entrar */
  "voice:sync": (payload: {
    serverId: string;
    participants: VoiceParticipant[];
  }) => void;
  /**
   * Um participante de voz mudou. `channelId: null` significa que ele SAIU
   * da voz — um evento so para entrar, sair, trocar de canal e mutar evita
   * que o cliente precise reconciliar tres fluxos diferentes.
   */
  "voice:update": (payload: {
    serverId: string;
    participant: VoiceParticipant;
  }) => void;
  /** uma unica mudanca de presenca dentro de um servidor */
  "presence:update": (payload: {
    serverId: string;
    entry: PresenceEntry;
  }) => void;
}

export interface ClientToServerEvents {
  /**
   * Entra no servidor. O gateway revalida que voce e membro e so entao te
   * coloca nas salas — inclusive nas salas dos canais que voce pode ver.
   */
  "server:join": (
    serverId: string,
    ack: (result: JoinServerAck) => void,
  ) => void;
  "server:leave": (serverId: string) => void;
  /** troca deliberada de status (ONLINE / IDLE / DND); persiste como preferencia */
  "presence:set": (status: UserStatus) => void;
  /**
   * Envia mensagem. O `nonce` e gerado pelo cliente e devolvido no ack e no
   * evento: e o que torna o reenvio apos reconexao idempotente na tela.
   */
  "message:send": (
    payload: { channelId: string; content: string; nonce: string },
    ack: (result: SendMessageAck) => void,
  ) => void;
  /**
   * Historico do canal. `before` pagina para tras (rolar para cima);
   * `after` busca o intervalo perdido durante uma queda de conexao.
   */
  "message:history": (
    payload: { channelId: string; before?: string; after?: string },
    ack: (result: MessageHistoryAck) => void,
  ) => void;
  /**
   * Conecta em um canal de voz. Ainda SEM midia — a fase 4 acopla o WebRTC.
   * O gateway e a fonte de verdade de quem esta em qual canal, entao entrar
   * por aqui e o que faz o nome aparecer sob o canal para todo mundo.
   */
  "voice:join": (
    payload: { channelId: string },
    ack: (result: VoiceJoinAck) => void,
  ) => void;
  /** desconecta da voz, seja qual for o canal */
  "voice:leave": () => void;
  /**
   * "estou falando agora". Calculado NO CLIENTE a partir do proprio
   * microfone: o navegador mede o volume localmente e manda so um booleano.
   * Nenhum audio trafega — isso e sinalizacao, nao midia.
   *
   * O cliente emite apenas na TRANSICAO, nunca em fluxo continuo.
   */
  "voice:speaking": (speaking: boolean) => void;
  /** sinaliza microfone/audio proprio; os demais campos sao de moderacao (fase 6) */
  "voice:state": (payload: {
    selfMuted?: boolean;
    selfDeafened?: boolean;
  }) => void;
  /** medicao de latencia; o ack responde o timestamp do servidor */
  ping: (ack: (serverTime: number) => void) => void;
}

/** Dados que o gateway guarda por socket. */
export interface SocketData {
  userId: string;
  sessionId: string;
  user: PublicUser;
}

/**
 * Nomes de sala. Uma funcao em vez de string solta para o gateway e os testes
 * nunca discordarem sobre o formato.
 */
export const room = {
  server: (serverId: string) => `server:${serverId}`,
  channel: (channelId: string) => `channel:${channelId}`,
} as const;

/** Estado de voz publicado pelo gateway (fase 3c preenche de verdade). */
export type VoiceStatePayload = VoiceState;
