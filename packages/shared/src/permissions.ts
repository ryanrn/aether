/**
 * Sistema de permissoes por bitfield.
 *
 * Regras de ouro (validas para TODAS as fases do projeto):
 *  1. O frontend NUNCA decide permissao. Ele apenas esconde/mostra UI.
 *     Toda acao passa por um guard no servidor (ver apps/web/src/server/guards.ts).
 *  2. Permissoes efetivas = uniao (OR) das permissoes de todos os cargos do membro,
 *     depois aplicados os overwrites do canal (deny primeiro, allow depois).
 *  3. ADMINISTRATOR e o dono do servidor ignoram qualquer checagem.
 *
 * Usamos bigint porque passamos de 32 flags rapidamente e o Postgres guarda em BIGINT.
 */

export const Permission = {
  /** Ignora todas as demais checagens dentro do servidor. */
  ADMINISTRATOR: 1n << 0n,
  /** Editar nome, icone e configuracoes gerais do servidor. */
  MANAGE_SERVER: 1n << 1n,
  /** Criar, editar, excluir e reordenar cargos. */
  MANAGE_ROLES: 1n << 2n,
  /** Criar canais e categorias. */
  CREATE_CHANNEL: 1n << 3n,
  /** Renomear/mover/reconfigurar canais existentes. */
  EDIT_CHANNEL: 1n << 4n,
  /** Excluir canais. */
  DELETE_CHANNEL: 1n << 5n,
  /** Ver o canal na arvore e abrir o historico. */
  VIEW_CHANNEL: 1n << 6n,
  /** Entrar em canal de voz. */
  CONNECT: 1n << 7n,
  /** Transmitir microfone no canal de voz. */
  SPEAK: 1n << 8n,
  /** Compartilhar tela/janela/aba. */
  SCREEN_SHARE: 1n << 9n,
  /** Enviar mensagens em canais de texto. */
  SEND_MESSAGES: 1n << 10n,
  /** Editar/excluir mensagens de terceiros. */
  MANAGE_MESSAGES: 1n << 11n,
  /** Arrastar outros usuarios entre canais de voz. */
  MOVE_MEMBERS: 1n << 12n,
  /** Silenciar microfone de terceiros no servidor. */
  MUTE_MEMBERS: 1n << 13n,
  /** Desativar audio de terceiros no servidor. */
  DEAFEN_MEMBERS: 1n << 14n,
  /** Remover membro do servidor. */
  KICK_MEMBERS: 1n << 15n,
  /** Banir membro do servidor. */
  BAN_MEMBERS: 1n << 16n,
  /** Gerar links de convite. */
  CREATE_INVITE: 1n << 17n,
  /** Alterar apelido de terceiros. */
  MANAGE_NICKNAMES: 1n << 18n,
  /** Ler o log de auditoria. */
  VIEW_AUDIT_LOG: 1n << 19n,
} as const;

export type PermissionKey = keyof typeof Permission;
export type PermissionBits = bigint;

/** Metadados para renderizar o painel de cargos (fase 2 / fase 6). */
export const PERMISSION_METADATA: Record<
  PermissionKey,
  { label: string; description: string; group: "geral" | "canais" | "voz" | "moderacao" }
> = {
  ADMINISTRATOR: {
    label: "Administrar servidor",
    description: "Concede todas as permissoes e ignora restricoes de canal.",
    group: "geral",
  },
  MANAGE_SERVER: {
    label: "Gerenciar servidor",
    description: "Alterar nome, icone e configuracoes gerais.",
    group: "geral",
  },
  MANAGE_ROLES: {
    label: "Gerenciar cargos",
    description: "Criar, editar e atribuir cargos abaixo do seu.",
    group: "geral",
  },
  VIEW_AUDIT_LOG: {
    label: "Ver logs",
    description: "Acessar o registro de auditoria do servidor.",
    group: "geral",
  },
  CREATE_CHANNEL: {
    label: "Criar canal",
    description: "Criar canais de voz, texto e categorias.",
    group: "canais",
  },
  EDIT_CHANNEL: {
    label: "Editar canal",
    description: "Renomear, mover e reconfigurar canais.",
    group: "canais",
  },
  DELETE_CHANNEL: {
    label: "Excluir canal",
    description: "Remover canais permanentemente.",
    group: "canais",
  },
  VIEW_CHANNEL: {
    label: "Ver canais",
    description: "Enxergar o canal na arvore e ler o historico.",
    group: "canais",
  },
  SEND_MESSAGES: {
    label: "Enviar mensagens",
    description: "Publicar mensagens em canais de texto.",
    group: "canais",
  },
  MANAGE_MESSAGES: {
    label: "Gerenciar mensagens",
    description: "Excluir mensagens de outros usuarios.",
    group: "canais",
  },
  CONNECT: {
    label: "Conectar em voz",
    description: "Entrar em canais de voz.",
    group: "voz",
  },
  SPEAK: {
    label: "Falar",
    description: "Transmitir microfone no canal de voz.",
    group: "voz",
  },
  SCREEN_SHARE: {
    label: "Compartilhar tela",
    description: "Transmitir tela, janela ou aba do navegador.",
    group: "voz",
  },
  MOVE_MEMBERS: {
    label: "Mover usuarios",
    description: "Arrastar outros membros entre canais de voz.",
    group: "moderacao",
  },
  MUTE_MEMBERS: {
    label: "Mutar usuarios",
    description: "Silenciar o microfone de outros membros.",
    group: "moderacao",
  },
  DEAFEN_MEMBERS: {
    label: "Desativar audio de usuarios",
    description: "Ensurdecer outros membros no canal.",
    group: "moderacao",
  },
  KICK_MEMBERS: {
    label: "Expulsar usuarios",
    description: "Remover membros do servidor.",
    group: "moderacao",
  },
  BAN_MEMBERS: {
    label: "Banir usuarios",
    description: "Banir membros permanentemente.",
    group: "moderacao",
  },
  CREATE_INVITE: {
    label: "Criar convite",
    description: "Gerar links de convite para o servidor.",
    group: "moderacao",
  },
  MANAGE_NICKNAMES: {
    label: "Gerenciar apelidos",
    description: "Alterar o apelido de outros membros.",
    group: "moderacao",
  },
};

export const ALL_PERMISSIONS: PermissionBits = Object.values(Permission).reduce(
  (acc, bit) => acc | bit,
  0n,
);

/** Combina uma lista de flags em um bitfield. */
export function combine(...keys: PermissionKey[]): PermissionBits {
  return keys.reduce<PermissionBits>((acc, key) => acc | Permission[key], 0n);
}

/** Testa se o bitfield contem a permissao. ADMINISTRATOR satisfaz qualquer teste. */
export function has(bits: PermissionBits, key: PermissionKey): boolean {
  if ((bits & Permission.ADMINISTRATOR) !== 0n) return true;
  return (bits & Permission[key]) !== 0n;
}

/** Testa varias permissoes de uma vez (AND logico). */
export function hasAll(bits: PermissionBits, keys: PermissionKey[]): boolean {
  return keys.every((key) => has(bits, key));
}

/** Lista textual das flags ativas — util para o log de auditoria. */
export function toKeys(bits: PermissionBits): PermissionKey[] {
  return (Object.keys(Permission) as PermissionKey[]).filter(
    (key) => (bits & Permission[key]) !== 0n,
  );
}

/**
 * Aplica overwrites de canal sobre as permissoes base do membro.
 * Ordem: base -> deny dos cargos -> allow dos cargos -> deny do membro -> allow do membro.
 * (usado a partir da fase 2, ja definido aqui para nao mudar contrato depois)
 */
export function applyOverwrites(
  base: PermissionBits,
  roleOverwrites: { allow: PermissionBits; deny: PermissionBits }[],
  memberOverwrite?: { allow: PermissionBits; deny: PermissionBits },
): PermissionBits {
  if ((base & Permission.ADMINISTRATOR) !== 0n) return ALL_PERMISSIONS;

  let result = base;
  let roleDeny = 0n;
  let roleAllow = 0n;
  for (const ow of roleOverwrites) {
    roleDeny |= ow.deny;
    roleAllow |= ow.allow;
  }
  result &= ~roleDeny;
  result |= roleAllow;

  if (memberOverwrite) {
    result &= ~memberOverwrite.deny;
    result |= memberOverwrite.allow;
  }
  return result;
}

/** Cargos criados automaticamente quando um servidor nasce. */
export const DEFAULT_ROLE_TEMPLATES = [
  {
    name: "Owner",
    color: "#19D3B4",
    position: 100,
    isDefault: false,
    isOwner: true,
    permissions: ALL_PERMISSIONS,
  },
  {
    name: "Administrator",
    color: "#7DA2FF",
    position: 80,
    isDefault: false,
    isOwner: false,
    permissions: combine(
      "MANAGE_SERVER",
      "MANAGE_ROLES",
      "CREATE_CHANNEL",
      "EDIT_CHANNEL",
      "DELETE_CHANNEL",
      "VIEW_CHANNEL",
      "CONNECT",
      "SPEAK",
      "SCREEN_SHARE",
      "SEND_MESSAGES",
      "MANAGE_MESSAGES",
      "MOVE_MEMBERS",
      "MUTE_MEMBERS",
      "DEAFEN_MEMBERS",
      "KICK_MEMBERS",
      "BAN_MEMBERS",
      "CREATE_INVITE",
      "MANAGE_NICKNAMES",
      "VIEW_AUDIT_LOG",
    ),
  },
  {
    name: "Moderator",
    color: "#F2B45E",
    position: 60,
    isDefault: false,
    isOwner: false,
    permissions: combine(
      "VIEW_CHANNEL",
      "CONNECT",
      "SPEAK",
      "SCREEN_SHARE",
      "SEND_MESSAGES",
      "MANAGE_MESSAGES",
      "MOVE_MEMBERS",
      "MUTE_MEMBERS",
      "DEAFEN_MEMBERS",
      "KICK_MEMBERS",
      "CREATE_INVITE",
      "MANAGE_NICKNAMES",
    ),
  },
  {
    name: "Member",
    color: "#9AA6B8",
    position: 10,
    isDefault: true,
    isOwner: false,
    permissions: combine(
      "VIEW_CHANNEL",
      "CONNECT",
      "SPEAK",
      "SCREEN_SHARE",
      "SEND_MESSAGES",
      "CREATE_INVITE",
    ),
  },
  {
    name: "Guest",
    color: "#6B7688",
    position: 1,
    isDefault: false,
    isOwner: false,
    permissions: combine("VIEW_CHANNEL", "CONNECT", "SEND_MESSAGES"),
  },
] as const;
