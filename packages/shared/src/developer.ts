/**
 * Contrato PUBLICO da AETHER Developer Platform.
 *
 * O que um desenvolvedor externo vê: os nomes de evento, o formato de erro da
 * API, os limites. Mora em `@aether/shared` porque a REST v1 (`apps/web`), o
 * Gateway de bot (`apps/realtime`) e uma futura doc geram tudo daqui — uma
 * cópia só, como `events.ts` faz para o vocabulário interno.
 *
 * NADA aqui é usado por produto ainda: as etapas seguintes da fundação ligam.
 */

/** Prefixo de versão da API. `/api/v1/...`. */
export const API_VERSION = "v1";

/**
 * Formato de erro da REST v1 — TODO erro sai assim, com um `code` estável que
 * o bot pode casar e uma `message` legível.
 */
export interface ApiErro {
  error: {
    code: ApiErroCodigo;
    message: string;
  };
}

export type ApiErroCodigo =
  | "unauthorized" // token ausente / inválido / revogado / app bloqueada
  | "not_found" // recurso inexistente OU sem acesso (nunca revelamos qual)
  | "bad_request" // corpo/parâmetro inválido
  | "rate_limited" // passou do limite — ver `Retry-After`
  | "gateway_unavailable"; // o serviço de mensagens não respondeu

/** Mensagens padrão por código — o bot deve ler o `code`, não o texto. */
export const API_ERRO_MENSAGEM: Record<ApiErroCodigo, string> = {
  unauthorized: "Token de bot ausente ou inválido.",
  not_found: "Recurso não encontrado.",
  bad_request: "Requisição inválida.",
  rate_limited: "Muitas requisições. Aguarde e tente de novo.",
  gateway_unavailable: "Serviço de mensagens indisponível no momento.",
};

/**
 * Limites da API — janela deslizante (o mesmo mecanismo do rate limit do
 * login: `limitarJanelaDeslizante` no Redis REST).
 *
 * VALORES INICIAIS, a calibrar contra tráfego real. Um lugar só para mexer —
 * de propósito NÃO são variável de ambiente (ninguém sobe `LIMITE=999999` em
 * produção sem querer).
 *
 * Chaves:
 *  - `rl:bot:<appId>`               teto global do app
 *  - `rl:bot:<appId>:srv:<serverId>` por servidor
 *  - `rl:bot:<appId>:ch:<channelId>` só envio, por canal (o freio contra loop)
 */
export const API_LIMITES = {
  global: { limite: 30, janelaMs: 10_000 },
  porServidor: { limite: 15, janelaMs: 10_000 },
  envioPorCanal: { limite: 5, janelaMs: 5_000 },
  /** webhook de entrada — chave `rl:wh:<webhookId>` */
  webhook: { limite: 5, janelaMs: 10_000 },
} as const;

/** `GET /api/v1/users/me` — a identidade do próprio bot. */
export interface ApiSelf {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  /** sempre `"BOT"` aqui — só bot chama a API */
  kind: "BOT";
  /** id da Application dona */
  applicationId: string;
}

/** `GET /api/v1/servers/:serverId` */
export interface ApiServer {
  id: string;
  name: string;
  iconUrl: string | null;
}

/** `GET /api/v1/servers/:serverId/channels` — só o que o bot enxerga. */
export interface ApiChannel {
  id: string;
  name: string;
  type: "TEXT" | "VOICE";
  topic: string | null;
  position: number;
  categoryId: string | null;
}

/**
 * `POST /api/v1/channels/:channelId/voice` — credenciais para o bot entrar na
 * sala LiveKit deste canal (EXPERIMENTAL — Music Bot).
 *
 * Mesmo formato de `MediaGrant` (o que o cliente humano recebe no
 * `voice:join`), mais `roomName` explícito: o bot não deve reconstruir o nome
 * da sala sozinho a partir de uma convenção interna (`channel:<id>`) que pode
 * mudar sem aviso — melhor o servidor dizer.
 */
export interface ApiVoiceGrant {
  url: string;
  token: string;
  roomName: string;
  /** o bot tem SPEAK neste canal? sem isso o token não permite publicar microfone */
  canPublish: boolean;
  canShareScreen: boolean;
  canUseCamera: boolean;
  /** epoch (ms) do vencimento — o bot deve pedir de novo antes disso */
  expiresAt: number;
}

/**
 * Nomes dos eventos que o Gateway de bot entrega (Etapa 10 em diante).
 * `NOUN_VERB` maiúsculo — a convenção do ecossistema, diferente do
 * `dominio:acao` interno de propósito (são camadas diferentes).
 *
 * A v1 entrega SÓ `MESSAGE_CREATE`. Os outros ficam declarados para o contrato
 * já existir quando forem ligados.
 */
export const EVENTOS_DE_BOT = [
  "MESSAGE_CREATE",
  // reservados — ainda não emitidos:
  // "MESSAGE_UPDATE", "MESSAGE_DELETE",
  // "CHANNEL_CREATE", "CHANNEL_UPDATE", "CHANNEL_DELETE",
  // "MEMBER_ADD", "MEMBER_REMOVE",
] as const;

export type EventoDeBot = (typeof EVENTOS_DE_BOT)[number];

// --------------------------------------------------------------------------
// Bot Gateway (Etapa 9+) — o socket que o bot abre para RECEBER eventos.
//
// Namespace `/gateway` (path `/ws`, o mesmo do app). Auth no handshake:
// `io("wss://<gateway>/gateway", { path: "/ws", auth: { token: "aeb_..." } })`.
// O gateway resolve o token, junta o socket nas salas dos canais que o bot
// enxerga (`Installation` -> `loadMemberAccess` -> `visibleChannelRooms`) e
// emite `ready`. Sem RESUME na v1: reconectar refaz tudo, e o bot reconcilia
// o que perdeu pela REST.
// --------------------------------------------------------------------------

/** Primeiro evento após o handshake do bot — confirma quem ele é e onde está. */
export interface BotReady {
  application: { id: string; name: string };
  bot: { id: string; username: string; displayName: string };
  /** servidores onde o bot está instalado E ainda é membro */
  servers: Array<{ id: string; name: string }>;
  /**
   * Intervalo de heartbeat em ms — informativo. O `socket.io-client` já faz o
   * ping/pong do Engine.IO sozinho; isto é só para o bot logar/monitorar.
   */
  heartbeatMs: number;
}

/** O que o gateway emite para o socket do bot. */
export interface BotGatewayServerEvents {
  ready: (payload: BotReady) => void;
  /** um evento do AETHER — `t` é o nome, `d` o payload. */
  dispatch: (payload: DispatchDeBot) => void;
}

export type DispatchDeBot = {
  t: "MESSAGE_CREATE";
  d: EventMessageCreate;
};

/** O autor de uma mensagem, como o bot recebe (mais enxuto que `PublicUser`). */
export interface EventMessageAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  /** `true` quando veio de um bot ou de um webhook */
  bot: boolean;
}

/**
 * `MESSAGE_CREATE` — mensagem nova num canal de servidor onde o bot está.
 * DM não entra: o bot não participa de conversa direta.
 */
export interface EventMessageCreate {
  id: string;
  channelId: string;
  serverId: string;
  content: string;
  author: EventMessageAuthor;
  /** ISO */
  createdAt: string;
  /** id da mensagem respondida, ou `null` */
  replyToId: string | null;
}

/** O que o bot emite para o gateway. v1: nada (auth e heartbeat são implícitos). */
export type BotGatewayClientEvents = Record<string, never>;

/** Dados que o gateway guarda por socket de bot. */
export interface BotSocketData {
  applicationId: string;
  botUserId: string;
  /** categorias de evento pedidas (default `["messages"]`) — a Etapa 10 filtra */
  intents: string[];
}
