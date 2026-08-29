/**
 * O contrato entre a ponte e o Roblox. Um arquivo so, de proposito: e o unico
 * lugar onde os dois lados precisam concordar, e concordar por acidente e como
 * permissao duplicada — funciona ate divergir.
 */

/** Quem comentou. `id` e estavel; `handle` a pessoa pode trocar amanha. */
export interface Viewer {
  /** `tiktok:<userId>` — prefixado para nao colidir com outra fonte no futuro. */
  id: string;
  /** O @ sem arroba. Pode vir vazio se o TikTok nao mandar. */
  handle: string;
  /** Nome de exibicao. Pode ter emoji, pode ter qualquer coisa. */
  nickname: string;
  avatarUrl: string | null;
  /**
   * So preenchido quando a pessoa vinculou a conta com "roblox <usuario>".
   * Com isto o jogo invoca o avatar DELA em vez do boneco padrao.
   */
  robloxUserId: number | null;
}

export type ActionSource = "chat" | "gift" | "like" | "follow" | "share" | "system";

/**
 * Uma acao ja decidida: o Roblox nao interpreta texto, so executa `kind`.
 *
 * Por que a ponte decide o `kind` e nao o jogo: trocar palavra-chave (ou
 * adicionar portugues/espanhol) vira edicao de arquivo aqui, sem republicar o
 * jogo no Roblox — que leva minutos e derruba o servidor ao vivo.
 */
export interface Action {
  /** Monotonico por jogo. E o cursor: o Roblox pede "o que veio depois de N". */
  seq: number;
  /** Epoch ms de quando o comentario chegou, para descartar acao velha. */
  at: number;
  kind: string;
  /** A palavra que casou, para log e para o jogo mostrar na tela se quiser. */
  keyword: string | null;
  source: ActionSource;
  viewer: Viewer;
  /** Especifico da acao: cor, texto, nome do presente, quantidade. */
  params: Record<string, string | number | boolean>;
}

/** Evento cru, antes de virar acao. E o que toda fonte (live ou simulador) emite. */
export interface RawEvent {
  source: ActionSource;
  viewer: Viewer;
  /** Texto do comentario. Vazio em like/gift/follow. */
  text: string;
  /** Presente: nome, quantidade e diamantes. Like: quantidade. */
  params?: Record<string, string | number | boolean>;
}

export interface GameConfig {
  id: string;
  name: string;
  /** Segredo compartilhado com o script do Roblox. */
  key: string;
  /** Usuario do TikTok cuja live alimenta este jogo. */
  tiktok: string;
  /** Perfil de palavras-chave. Hoje so existe "default". */
  profile: string;
  /** Comentario sem palavra-chave tambem invoca o boneco de quem falou. */
  spawnOnAnyComment: boolean;
  /** Universe ID, so para o push via Open Cloud. `null` = so long polling. */
  universeId: string | null;
}

export interface PullResult {
  actions: Action[];
  cursor: number;
  /** Quantas acoes o jogo perdeu entre o cursor pedido e a primeira entregue. */
  dropped: number;
  queued: number;
}
