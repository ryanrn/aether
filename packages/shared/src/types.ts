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
  /** detectado como falando agora */
  speaking: boolean;
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
export interface PublicMessage {
  id: string;
  channelId: string;
  content: string;
  author: PublicUser;
  createdAt: string;
  editedAt: string | null;
}

/**
 * Formato cru vindo do banco. Declarado aqui — sem importar Prisma — para que
 * o app web e o gateway produzam PublicMessage pela MESMA funcao.
 */
export interface MessageRow {
  id: string;
  channelId: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    status: string;
  };
}

export function toPublicMessage(row: MessageRow): PublicMessage {
  return {
    id: row.id,
    channelId: row.channelId,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    author: {
      id: row.author.id,
      username: row.author.username,
      displayName: row.author.displayName,
      avatarUrl: row.author.avatarUrl,
      status: isUserStatus(row.author.status) ? row.author.status : "OFFLINE",
    },
  };
}
