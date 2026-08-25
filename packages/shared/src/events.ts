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
  /**
   * Jogo detectado pelo app de desktop, ou `null`.
   *
   * Fica na PRESENCA e nao no estado de voz de proposito: da para estar
   * jogando sem estar em canal nenhum, e amarrar as duas coisas faria o jogo
   * sumir da tela de quem saiu da call sem ter fechado o jogo.
   *
   * Quem detecta e a maquina de quem joga — o navegador nao enumera processos.
   * O servidor nunca ve a lista de programas, so este nome.
   */
  game: string | null;
  /** desde quando neste jogo (ISO), para contar o tempo de sessao */
  gameSince: string | null;
  /**
   * Icone do jogo como data URL, extraido do executavel na maquina de quem
   * joga. `null` quando nao deu para extrair — nome sem icone continua util.
   */
  gameIcon: string | null;
  /**
   * Capa do jogo (URL), resolvida pelo SERVIDOR no IGDB. `null` quando o jogo
   * nao foi encontrado, ou quando o IGDB nao esta configurado.
   *
   * Convive com `gameIcon` em vez de substitui-lo, e isso e a cadeia de
   * fallback: capa (264x374, arte de verdade) e melhor que icone de
   * executavel (48px), mas so existe para jogo que o IGDB conhece. Quem
   * desenha escolhe a primeira que houver — e nunca fica sem nada.
   *
   * Vem como URL, e nao embutida como o icone, porque nasce num CDN publico:
   * embutir obrigaria o servidor a baixar e reencodar a imagem de todo jogo.
   */
  gameCover: string | null;
}

/** Tamanho maximo do nome de jogo aceito — nome de pasta nao passa disso. */
export const GAME_NAME_MAX = 64;

/**
 * Teto do icone do jogo, em caracteres do data URL.
 *
 * Um icone de 48x48 extraido de executavel da uns 4KB; 32KB deixa folga
 * larga e ainda impede alguem de empurrar uma imagem grande pela presenca,
 * que e um evento que vai para a sala inteira.
 */
export const GAME_ICON_MAX_CHARS = 32 * 1024;

/**
 * O icone e um data URL de imagem RASTER que podemos exibir?
 *
 * Isto vem do CLIENTE e e renderizado na tela dos OUTROS, entao a checagem
 * nao e sobre formato bonito, e sobre seguranca:
 *
 *  - so `png`, `jpeg` e `webp`. **SVG fica de fora de proposito**: SVG e um
 *    documento, aceita `<script>`, e existe caminho de execucao quando ele e
 *    renderizado. Nenhuma imagem de icone precisa ser SVG;
 *  - so base64, para nao aceitar payload de texto arbitrario;
 *  - com teto de tamanho.
 *
 * Devolve o proprio icone quando serve, ou `null` — quem chama simplesmente
 * segue sem icone, porque nome sem icone continua util.
 */
/**
 * A capa e uma URL de imagem do CDN do IGDB?
 *
 * Diferente do `safeGameIcon`, isto NAO vem do cliente — quem monta e o
 * proprio gateway, a partir do `image_id`. A checagem existe mesmo assim
 * porque o valor sai do banco e vai para o `src` de uma imagem na tela de
 * outras pessoas: um dia alguem edita a tabela na mao, ou escreve um provedor
 * novo, e a garantia precisa estar no caminho por onde o dado passa — nao na
 * memoria de quem escreveu.
 *
 * Host fixo de proposito. Nao e "uma URL https qualquer": e o CDN do IGDB.
 */
export function safeGameCover(cover: unknown): string | null {
  if (typeof cover !== "string") return null;
  if (cover.length === 0 || cover.length > 300) return null;
  if (!/^https:\/\/images\.igdb\.com\/igdb\/image\/upload\/[A-Za-z0-9_]+\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(cover)) {
    return null;
  }
  return cover;
}

export function safeGameIcon(icon: unknown): string | null {
  if (typeof icon !== "string") return null;
  if (icon.length === 0 || icon.length > GAME_ICON_MAX_CHARS) return null;
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(icon)) {
    return null;
  }
  return icon;
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

/**
 * Credenciais para o SFU. `null` quando o servidor nao tem LiveKit
 * configurado — nesse caso a ocupacao de canal funciona e o audio nao existe,
 * o que a interface precisa saber para nao prometer o que nao entrega.
 */
export interface MediaGrant {
  url: string;
  token: string;
  /** o token permite publicar microfone (depende de SPEAK) */
  canPublish: boolean;
  /** o token permite publicar tela (depende de SCREEN_SHARE) — fase 5 */
  canShareScreen: boolean;
  /** o token permite publicar a camera (depende de CAMERA) */
  canUseCamera: boolean;
}

export type VoiceModerateAck =
  | { ok: true }
  | { ok: false; error: string };

export type VoiceJoinAck =
  | {
      ok: true;
      participants: VoiceParticipant[];
      media: MediaGrant | null;
    }
  | { ok: false; error: string };

export interface ServerToClientEvents {
  /** primeiro evento apos o handshake: confirma quem o gateway achou que voce e */
  ready: (payload: ReadyPayload) => void;
  /**
   * Voce foi removido deste servidor (expulso ou banido).
   *
   * Existe porque o socket entra nas salas do servidor e nunca recalcula: sem
   * este aviso, quem foi expulso continuaria recebendo o chat ate recarregar a
   * pagina — o que e falha de acesso, nao so tela desatualizada.
   */
  "server:evicted": (payload: { serverId: string; reason: string }) => void;
  /**
   * Sua sessao nao vale mais (logout, revogacao, expiracao). O gateway
   * revalida periodicamente a linha `Session` de cada socket aberto — sem
   * este aviso, o cliente cairia num retry infinito e silencioso contra uma
   * sessao morta em vez de saber que precisa logar de novo.
   */
  "session:revoked": () => void;
  /**
   * Algo mudou na estrutura deste servidor (canal criado/editado/movido/
   * excluido, categoria, cargo, acesso de canal privado).
   *
   * De proposito NAO carrega o que mudou. A arvore de canais e renderizada no
   * servidor, com as permissoes de quem esta olhando; mandar o conteudo pelo
   * socket exigiria o gateway recalcular e serializar permissao por usuario —
   * uma segunda copia da regra de autorizacao, que e exatamente o que este
   * projeto nao faz. O cliente recebe o sinal e pede ao Next para
   * re-renderizar, e a regra continua morando num lugar so.
   *
   * Por isso tambem e seguro mandar para a sala inteira do servidor: quem nao
   * pode ver um canal simplesmente re-renderiza e recebe a mesma arvore de
   * antes. O sinal em si nao revela nada.
   */
  "server:changed": (payload: { serverId: string }) => void;
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
  /**
   * Voce foi movido para outro canal de voz por um moderador.
   *
   * Vem com credenciais novas porque cada canal e uma sala propria no SFU: o
   * token antigo nao vale na sala nova, e emitir aqui evita o cliente ter de
   * pedir e ficar mudo no intervalo.
   */
  "voice:moved": (payload: {
    channelId: string;
    media: MediaGrant | null;
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
  /**
   * Presenca de um AMIGO, pela sala pessoal.
   *
   * Evento separado de `presence:update` por uma razao de privacidade, nao de
   * organizacao: aquele carrega `serverId`, e mandar isso a um amigo que nao e
   * membro revelaria que o servidor existe — inclusive servidores privados.
   * Aqui vai so a pessoa e o que ela esta fazendo.
   *
   * O que NAO vai junto, tambem de proposito: em qual canal de voz ela esta.
   * Isso continua sendo `voice:update`, restrito a sala do servidor, porque
   * canal de voz so faz sentido para quem e membro dali.
   */
  "friend:presence": (payload: { entry: PresenceEntry }) => void;
  /** presenca de todos os amigos online, ao conectar */
  "friend:sync": (payload: { entries: PresenceEntry[] }) => void;
  /**
   * A LISTA de amizades mudou (pedido novo, aceite, recusa, remocao).
   *
   * Nao carrega o que mudou, pelo mesmo motivo de `server:changed`: a lista e
   * renderizada no servidor, e mandar o conteudo pelo socket faria o gateway
   * montar uma segunda versao da mesma consulta. O cliente recebe o sinal e
   * pede a lista nova ao Next.
   */
  "friend:changed": () => void;
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
   * "estou jogando X agora", ou `null` para limpar.
   *
   * Vem do app de desktop, que casa o processo LOCALMENTE e manda so o nome e
   * o icone ja extraido. O gateway trata tudo como dado de cliente, e nao como
   * verdade: corta o nome no tamanho maximo, valida o icone com
   * `safeGameIcon`, e nao persiste nada — jogo aberto e coisa do momento,
   * como a propria presenca.
   */
  "presence:game": (
    payload: { name: string; icon?: string | null } | null,
  ) => void;
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
   * Moderacao de voz sobre outra pessoa: silenciar ou ensurdecer pelo servidor.
   * Diferente de `voice:state`, que e sobre voce mesmo.
   */
  "voice:moderate": (
    payload: {
      userId: string;
      serverMuted?: boolean;
      serverDeafened?: boolean;
    },
    ack: (result: VoiceModerateAck) => void,
  ) => void;
  /** move outra pessoa para outro canal de voz do mesmo servidor */
  "voice:move": (
    payload: { userId: string; channelId: string },
    ack: (result: VoiceModerateAck) => void,
  ) => void;
  /**
   * "estou falando agora". Calculado NO CLIENTE a partir do proprio
   * microfone: o navegador mede o volume localmente e manda so um booleano.
   * Nenhum audio trafega — isso e sinalizacao, nao midia.
   *
   * O cliente emite apenas na TRANSICAO, nunca em fluxo continuo.
   */
  "voice:speaking": (speaking: boolean) => void;
  /**
   * "estou compartilhando tela". O video em si vai pelo SFU; isto aqui e so a
   * sinalizacao, porque a arvore de canais precisa mostrar o indicador para
   * quem NAO esta na sala de midia — e o SFU so conhece a propria sala.
   */
  "voice:streaming": (streaming: boolean) => void;
  /** sinaliza microfone/audio proprio; os demais campos sao de moderacao (fase 6) */
  "voice:state": (payload: {
    selfMuted?: boolean;
    selfDeafened?: boolean;
  }) => void;
  /**
   * "estou com a camera ligada". Sinalizacao apenas — o video vai pelo SFU.
   *
   * Existe pela mesma razao do `voice:streaming`: a arvore de canais precisa
   * mostrar o indicador para quem NAO esta na sala de midia, e o SFU so
   * conhece a propria sala.
   */
  "voice:camera": (camera: boolean) => void;
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
  /**
   * Sala pessoal: todo socket entra na sua propria ao conectar.
   *
   * Existe porque amizade nao passa por servidor. Presenca so trafegava em
   * `server:<id>`, entao dois amigos sem servidor em comum nunca se veriam
   * online. Enderecar a pessoa (e nao o servidor) resolve isso sem inventar
   * um "servidor de amigos" fantasma.
   */
  user: (userId: string) => `user:${userId}`,
} as const;

/** Estado de voz publicado pelo gateway (fase 3c preenche de verdade). */
export type VoiceStatePayload = VoiceState;
