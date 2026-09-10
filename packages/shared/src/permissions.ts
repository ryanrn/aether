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
  /**
   * Ligar a camera num canal de voz.
   *
   * Bit PROPRIO, e nao emprestado do SCREEN_SHARE: mostrar a tela e mostrar o
   * rosto sao coisas diferentes, e uma equipe pode querer uma sem a outra.
   * Juntar as duas num bit so seria impossivel de separar depois sem quebrar
   * cargo de quem ja usa.
   *
   * CONSEQUENCIA de ser novo: cargo que ja existe NAO tem este bit — os
   * valores estao gravados no banco. Por isso ha o
   * `scripts/liberar-camera.mjs`, que concede a quem ja podia compartilhar
   * tela. Sem ele, o botao nasceria sem ninguem que pudesse usa-lo.
   */
  CAMERA: 1n << 20n,
  /**
   * Usar `@everyone` / `@here` para notificar o canal inteiro de uma vez.
   *
   * Declarada na fundacao da Developer Platform (Etapa 3): um bot ou webhook
   * NAO deve poder notificar todo mundo so por ter um token. AINDA NAO HA
   * comportamento — nao ha parsing de `@everyone` em lugar nenhum. Este bit so
   * existe para que, quando o parsing entrar, a regra ja tenha onde morar.
   *
   * Nasce em NENHUM template de cargo: dono e portador de `ADMINISTRATOR` ja
   * passam pelo curto-circuito de `has()`; o resto so ganha se um admin marcar.
   */
  MENTION_EVERYONE: 1n << 21n,
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
  MENTION_EVERYONE: {
    label: "Mencionar @everyone",
    description: "Usar @everyone e @here para notificar o canal inteiro.",
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
  CAMERA: {
    label: "Ligar a camera",
    description: "Mostrar a propria camera nos canais de voz.",
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

/**
 * O que um cargo vinculado a um jogo pode conceder (fase 2, estagio 2).
 *
 * O nome do jogo chega ao gateway como TEXTO DE CLIENTE nao verificado — o
 * app de desktop anuncia `presence:game` e nao ha lista de jogos validos para
 * conferir contra (ver `apps/realtime/src/handlers/presence.ts`). Qualquer um
 * pode dizer que joga X sem ter o jogo.
 *
 * Um cargo que se pega assim so pode dar acesso a ESTAR na sala: ver canal,
 * entrar em voz, falar, mostrar tela/camera, mandar mensagem. Nada de
 * moderacao, gerencia ou convite — senao "abrir um jogo" viraria um caminho
 * para poder banir gente. `updateRole` aplica esta mascara sobre o bitfield
 * sempre que o cargo tem jogo vinculado.
 */
export const PERMISSOES_DE_CARGO_DE_JOGO: PermissionBits = combine(
  "VIEW_CHANNEL",
  "CONNECT",
  "SPEAK",
  "SCREEN_SHARE",
  "CAMERA",
  "SEND_MESSAGES",
);

/**
 * Corta de um bitfield tudo que um cargo-por-jogo nao pode conceder. Aplicado
 * em `updateRole` sempre que o cargo tem jogo vinculado — o teto e este,
 * inclusive para o dono do servidor.
 */
export function permissoesDeCargoDeJogo(bits: PermissionBits): PermissionBits {
  return bits & PERMISSOES_DE_CARGO_DE_JOGO;
}

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

/**
 * Cargos criados automaticamente quando um servidor nasce.
 *
 * Os nomes sao DADOS, nao rotulo de tela: viram linhas na tabela `Role` e
 * podem ser renomeados por quem administra o servidor. Mudar aqui vale para os
 * servidores criados DEPOIS — os que ja existem seguem com o nome que
 * receberam quando nasceram.
 *
 * Nada no app procura cargo por nome: a autorizacao usa a flag `isOwner` e os
 * bits de permissao. Isso e o que torna renomear seguro, e e uma propriedade
 * que vale preservar — codigo que casa por texto quebra no dia em que alguem
 * renomeia o cargo dele.
 */
export const DEFAULT_ROLE_TEMPLATES = [
  {
    name: "Dono",
    color: "#19D3B4",
    position: 100,
    isDefault: false,
    isOwner: true,
    permissions: ALL_PERMISSIONS,
  },
  {
    name: "Administrador",
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
      "CAMERA",
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
    name: "Moderador",
    color: "#F2B45E",
    position: 60,
    isDefault: false,
    isOwner: false,
    permissions: combine(
      "VIEW_CHANNEL",
      "CONNECT",
      "SPEAK",
      "SCREEN_SHARE",
      "CAMERA",
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
    name: "Membro",
    color: "#9AA6B8",
    position: 10,
    isDefault: true,
    isOwner: false,
    permissions: combine(
      "VIEW_CHANNEL",
      "CONNECT",
      "SPEAK",
      "SCREEN_SHARE",
      "CAMERA",
      "SEND_MESSAGES",
      "CREATE_INVITE",
    ),
  },
  {
    name: "Convidado",
    color: "#6B7688",
    position: 1,
    isDefault: false,
    isOwner: false,
    permissions: combine("VIEW_CHANNEL", "CONNECT", "SEND_MESSAGES"),
  },
] as const;
