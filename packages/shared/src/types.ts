/**
 * Contratos compartilhados entre web, gateway realtime (fase 3) e servico de midia (fase 4/5).
 * Nada aqui depende de Prisma ou de React de proposito: e o vocabulario comum do sistema.
 */

export const USER_STATUSES = ["ONLINE", "IDLE", "DND", "OFFLINE"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Guarda de tipo para valor vindo da rede — nao confiamos no cliente. */
export function isUserStatus(value: unknown): value is UserStatus {
  return (
    typeof value === "string" &&
    (USER_STATUSES as readonly string[]).includes(value)
  );
}

export type ChannelType = "TEXT" | "VOICE";

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: UserStatus;
}

export interface PublicRole {
  id: string;
  name: string;
  color: string;
  position: number;
  isDefault: boolean;
  isOwner: boolean;
  /** bitfield serializado como string — bigint nao sobrevive a JSON.stringify */
  permissions: string;
}

export interface PublicMember {
  id: string;
  user: PublicUser;
  nickname: string | null;
  roles: PublicRole[];
  joinedAt: string;
}

export interface PublicChannel {
  id: string;
  name: string;
  topic: string | null;
  type: ChannelType;
  categoryId: string | null;
  position: number;
  isPrivate: boolean;
  isTemporary: boolean;
  userLimit: number | null;
}

export interface PublicCategory {
  id: string;
  name: string;
  position: number;
  channels: PublicChannel[];
}

export interface PublicServer {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  memberCount: number;
}

/**
 * Estado de voz de um membro. Alimentado pelo gateway (fase 3) e pelo SFU (fase 4).
 * Definido agora para que a UI da fase 1 ja renderize os indicadores corretos.
 */
export interface VoiceState {
  userId: string;
  channelId: string | null;
  /** o proprio usuario se mutou */
  selfMuted: boolean;
  /** o proprio usuario se ensurdeceu */
  selfDeafened: boolean;
  /** um moderador mutou o usuario */
  serverMuted: boolean;
  /** um moderador ensurdeceu o usuario */
  serverDeafened: boolean;
  /** esta transmitindo tela neste momento */
  streaming: boolean;
  /** a camera esta ligada — sinalizacao; o video em si vai pelo SFU */
  camera: boolean;
  /** detectado como falando agora */
  speaking: boolean;
  /**
   * Quando entrou no canal atual (ISO), para contar ha quanto tempo esta ali.
   *
   * Carimbado pelo GATEWAY, nunca pelo cliente: relogio de navegador erra, e
   * um cliente poderia mentir "estou aqui ha 8 horas". `null` quando a pessoa
   * nao esta em voz.
   *
   * Trocar de canal REINICIA a contagem — a atividade e "estar neste canal",
   * nao "estar em voz em algum lugar".
   */
  joinedAt: string | null;
}

/**
 * Quem esta olhando o servidor, do ponto de vista da UI.
 *
 * `permissions` e o bitfield serializado como string (bigint nao sobrevive a
 * serializacao entre servidor e cliente). Serve APENAS para mostrar/esconder
 * controles — toda action recalcula as permissoes no servidor.
 */
export interface ViewerContext {
  memberId: string;
  isOwner: boolean;
  permissions: string;
  roleIds: string[];
  highestRolePosition: number;
}

/** Permissoes efetivas por canal, ja com os overwrites aplicados. */
export type ChannelPermissionMap = Record<string, string>;

/** Estado de voz ja resolvido com o usuario — formato que a UI consome. */
export interface VoiceParticipant extends VoiceState {
  user: PublicUser;
}

/** Resultado padrao de toda server action — nunca lancamos erro cru para o cliente. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string };

/**
 * Mensagem de canal de texto, no formato que o cliente consome.
 *
 * Datas viram string ISO de proposito: `Date` nao sobrevive a serializacao
 * entre servidor e cliente nem ao JSON do socket, e converter em dois lugares
 * diferentes e como os fusos comecam a divergir.
 */
/**
 * Uma reacao AGRUPADA, do jeito que a tela desenha: o emoji, quantos e se voce
 * e um deles.
 *
 * Nao vai a lista de quem reagiu. Numa mensagem com trinta reacoes isso seriam
 * trinta usuarios completos por emoji viajando a cada carregamento de
 * historico, para desenhar um numero. Quem quiser ver os nomes um dia pede sob
 * demanda.
 */
export interface PublicReaction {
  emoji: string;
  count: number;
  /** Voce reagiu com este. E o que pinta o botao de aceso. */
  mine: boolean;
}

export interface PublicMessage {
  id: string;
  /**
   * Onde a mensagem vive: um canal de servidor OU uma conversa direta.
   *
   * NAO se chama `channelId` de proposito. Ate as conversas diretas
   * existirem, esse era o nome, e o cliente sempre usou o campo como CHAVE
   * (`messages[id]`, `unread[id]`, comparacao com a conversa aberta) — nunca
   * para buscar um `Channel`. Com dois tipos de pai possiveis, manter o nome
   * antigo deixaria pronta a armadilha de alguem escrever
   * `channel.findUnique({ id: message.channelId })` e receber `null` calado em
   * toda conversa direta.
   */
  conversationId: string;
  content: string;
  author: PublicUser;
  createdAt: string;
  editedAt: string | null;
  reactions: PublicReaction[];
}

/**
 * Formato cru vindo do banco. Declarado aqui — sem importar Prisma — para que
 * o app web e o gateway produzam PublicMessage pela MESMA funcao.
 */
export interface MessageRow {
  id: string;
  /** Preenchido quando a mensagem e de canal de servidor. */
  channelId: string | null;
  /** Preenchido quando a mensagem e de conversa direta. */
  dmChannelId: string | null;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  /** Cru do banco: uma linha por pessoa por emoji. O agrupamento e aqui. */
  reactions?: Array<{ emoji: string; userId: string }>;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    status: string;
  };
}

/**
 * Agrupa as linhas cruas em `{ emoji, count, mine }`.
 *
 * A ORDEM E ESTAVEL — primeiro emoji a aparecer fica na frente — porque a
 * alternativa (ordenar por contagem) faria os botoes SALTAREM de lugar quando
 * alguem reage: a pessoa mira num, e ele troca de posicao no clique.
 */
function agruparReacoes(
  linhas: Array<{ emoji: string; userId: string }>,
  selfUserId: string | null,
): PublicReaction[] {
  const porEmoji = new Map<string, PublicReaction>();
  for (const linha of linhas) {
    const atual = porEmoji.get(linha.emoji);
    if (atual) {
      atual.count += 1;
      if (linha.userId === selfUserId) atual.mine = true;
    } else {
      porEmoji.set(linha.emoji, {
        emoji: linha.emoji,
        count: 1,
        mine: linha.userId === selfUserId,
      });
    }
  }
  return [...porEmoji.values()];
}

/**
 * `selfUserId` decide o `mine` de cada reacao. Opcional porque nem todo
 * chamador tem quem esta olhando — sem ele, nada fica aceso, que e o padrao
 * seguro: pintar de aceso o que nao e seu seria mentira; deixar apagado o que
 * e seu so custa um clique a mais.
 */
export function toPublicMessage(
  row: MessageRow,
  selfUserId: string | null = null,
): PublicMessage {
  /**
   * Exatamente um dos dois esta preenchido — garantido pelo CHECK
   * `Message_um_pai_so` no banco. Se algum dia os dois vierem nulos, e melhor
   * quebrar alto aqui do que devolver `undefined` e virar chave invalida no
   * store do cliente, onde o sintoma seria "a mensagem sumiu".
   */
  const conversationId = row.channelId ?? row.dmChannelId;
  if (conversationId === null) {
    throw new Error(`Mensagem ${row.id} sem canal nem conversa`);
  }

  return {
    id: row.id,
    conversationId,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    reactions: agruparReacoes(row.reactions ?? [], selfUserId),
    author: {
      id: row.author.id,
      username: row.author.username,
      displayName: row.author.displayName,
      avatarUrl: row.author.avatarUrl,
      status: isUserStatus(row.author.status) ? row.author.status : "OFFLINE",
    },
  };
}

/**
 * Uma amizade do ponto de vista de QUEM esta olhando.
 *
 * O banco guarda `requesterId`/`addresseeId`, que sao sobre quem pediu. A tela
 * nunca quer isso: quer "a outra pessoa" e "de que lado esta a decisao". A
 * traducao acontece no servidor, uma vez, em vez de cada componente refazer o
 * mesmo `meuId === requesterId ? ... : ...` e um deles errar.
 */
export interface PublicFriendship {
  id: string;
  /** a outra ponta — nunca voce */
  user: PublicUser;
  /**
   * `friend` ja aceito; `incoming` alguem te pediu e a decisao e sua;
   * `outgoing` voce pediu e esta esperando; `blocked` voce bloqueou.
   *
   * `blocked` entra AQUI em vez de virar uma lista propria porque a tela ja
   * sabe desenhar uma pessoa a partir desta forma — nome, avatar, acoes. Uma
   * segunda forma seria uma segunda copia da linha, do agrupamento e da busca.
   */
  kind: "friend" | "incoming" | "outgoing" | "blocked";
  createdAt: string;
}
