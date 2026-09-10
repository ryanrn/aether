import "server-only";

import { randomBytes } from "node:crypto";
import { prisma, ChannelType, type Prisma } from "@aether/db";
import {
  DEFAULT_ROLE_TEMPLATES,
  has,
  SELECT_USUARIO_PUBLICO,
  toPublicUser,
  type PublicCategory,
  type PublicChannel,
  type PublicMember,
  type PublicRole,
  type PublicServer,
} from "@aether/shared";
import { getChannelPermissionMap } from "@aether/access";
import type { MemberContext } from "../guards";

/**
 * Camada de dados dos servidores. Sem "use server" e sem checagem de sessao:
 * quem chama e responsavel por ter passado pelos guards. Isso mantem as
 * consultas reaproveitaveis pelo gateway realtime (fase 3).
 */

/** Estrutura de canais criada junto com um servidor novo. */
const DEFAULT_TREE = [
  {
    category: "GERAL",
    channels: [
      { name: "geral", type: ChannelType.TEXT },
      { name: "Lobby", type: ChannelType.VOICE },
      { name: "Conversa", type: ChannelType.VOICE },
    ],
  },
  {
    category: "PRIVADO",
    channels: [{ name: "Sala Administrativa", type: ChannelType.VOICE, isPrivate: true }],
  },
] as const;

/**
 * Codigo de convite: 10 caracteres de um alfabeto sem ambiguidade visual
 * (`0/o`, `1/l/i` fora), ~49 bits de entropia. `@unique` no banco garante
 * unicidade; a colisao e improvavel o bastante para nao valer um retry loop.
 *
 * AMOSTRAGEM POR REJEICAO, e nao `byte % 30`: o modulo enviesa os primeiros
 * 256 % 30 = 16 simbolos (aparecem com prob. 9/256 contra 8/256 dos outros).
 * Descartar os bytes >= 240 (o maior multiplo de 30) tira o vies inteiro — e
 * `randomBytes` e barato, entao pedir alguns a mais nao pesa.
 */
export function generateInviteCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // 30 simbolos
  const teto = 256 - (256 % alphabet.length); // 240
  let code = "";
  while (code.length < 10) {
    for (const byte of randomBytes(16)) {
      if (byte >= teto) continue;
      code += alphabet[byte % alphabet.length];
      if (code.length === 10) break;
    }
  }
  return code;
}

/** Cria servidor + cargos padrao + arvore inicial + membro dono, em transacao. */
export async function createServerForUser(params: {
  ownerId: string;
  name: string;
}): Promise<{ serverId: string }> {
  return prisma.$transaction(async (tx) => {
    const server = await tx.server.create({
      data: {
        name: params.name,
        ownerId: params.ownerId,
        roles: {
          create: DEFAULT_ROLE_TEMPLATES.map((template) => ({
            name: template.name,
            color: template.color,
            permissions: template.permissions,
            position: template.position,
            isDefault: template.isDefault,
            isOwner: template.isOwner,
          })),
        },
      },
      include: { roles: true },
    });

    let categoryPosition = 0;
    for (const group of DEFAULT_TREE) {
      const category = await tx.category.create({
        data: {
          serverId: server.id,
          name: group.category,
          position: categoryPosition++,
        },
      });

      await tx.channel.createMany({
        data: group.channels.map((channel, index) => ({
          serverId: server.id,
          categoryId: category.id,
          name: channel.name,
          type: channel.type,
          position: index,
          isPrivate: "isPrivate" in channel ? channel.isPrivate : false,
        })),
      });
    }

    const ownerRole = server.roles.find((role) => role.isOwner);
    const defaultRole = server.roles.find((role) => role.isDefault);

    const member = await tx.serverMember.create({
      data: { serverId: server.id, userId: params.ownerId },
    });

    const roleLinks: Prisma.MemberRoleCreateManyInput[] = [];
    if (ownerRole) roleLinks.push({ memberId: member.id, roleId: ownerRole.id });
    if (defaultRole) roleLinks.push({ memberId: member.id, roleId: defaultRole.id });
    if (roleLinks.length > 0) {
      await tx.memberRole.createMany({ data: roleLinks });
    }

    await tx.invite.create({
      data: {
        code: generateInviteCode(),
        serverId: server.id,
        creatorId: params.ownerId,
      },
    });

    return { serverId: server.id };
  });
}

/** Servidores em que o usuario e membro — alimenta a barra lateral. */
export async function listServersForUser(userId: string): Promise<PublicServer[]> {
  const memberships = await prisma.serverMember.findMany({
    where: { userId },
    /**
     * `position` primeiro, `joinedAt` como desempate.
     *
     * O desempate importa: a coluna nasceu com 0 para todo mundo, entao sem
     * ele a ordem existente viraria indefinida da noite para o dia — a mesma
     * pessoa veria os icones em ordens diferentes a cada carregamento.
     */
    orderBy: [{ position: "asc" }, { joinedAt: "asc" }],
    select: {
      server: {
        select: {
          id: true,
          name: true,
          iconUrl: true,
          ownerId: true,
          _count: { select: { members: true } },
        },
      },
    },
  });

  return memberships.map(({ server }) => ({
    id: server.id,
    name: server.name,
    iconUrl: server.iconUrl,
    ownerId: server.ownerId,
    memberCount: server._count.members,
  }));
}

export interface ServerContext {
  server: PublicServer;
  categories: PublicCategory[];
  /** canais sem categoria */
  looseChannels: PublicChannel[];
  members: PublicMember[];
  /** permissoes efetivas do visitante em cada canal visivel (bitfield serializado) */
  channelPermissions: Record<string, string>;
  /** todos os cargos do servidor, do mais alto para o mais baixo */
  roles: PublicRole[];
  /**
   * O cargo automatico por jogo esta ligado neste servidor? (fase 2, estagio
   * 2). Governa se `Role.jogoVinculado` surte efeito. So a aba de cargos usa.
   */
  cargoPorJogo: boolean;
  /**
   * Salas de grupo (LFG) ligadas neste servidor? (fase 2, estagio 3). Governa
   * se o membro pode criar salas de grupo por jogo.
   */
  salasDeGrupo: boolean;
}

function toPublicChannel(channel: {
  id: string;
  name: string;
  topic: string | null;
  type: ChannelType;
  categoryId: string | null;
  position: number;
  isPrivate: boolean;
  isTemporary: boolean;
  jogo?: string | null;
  criadaPor?: string | null;
  userLimit: number | null;
}): PublicChannel {
  return {
    id: channel.id,
    name: channel.name,
    topic: channel.topic,
    type: channel.type,
    categoryId: channel.categoryId,
    position: channel.position,
    isPrivate: channel.isPrivate,
    isTemporary: channel.isTemporary,
    jogo: channel.jogo ?? null,
    criadaPor: channel.criadaPor ?? null,
    userLimit: channel.userLimit,
  };
}

/**
 * Carrega tudo que a tela do servidor precisa.
 *
 * O filtro de canais privados acontece AQUI, no servidor: um canal que o
 * visitante nao pode ver nunca chega a virar JSON. Esconder no cliente seria
 * apenas cosmetico — bastaria abrir o devtools para enumerar os canais.
 */
export async function getServerContext(
  serverId: string,
  viewer: MemberContext,
): Promise<ServerContext | null> {
  const permissionMap = await getChannelPermissionMap(viewer);

  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: {
      id: true,
      name: true,
      iconUrl: true,
      ownerId: true,
      cargoPorJogo: true,
      salasDeGrupo: true,
      _count: { select: { members: true } },
      categories: {
        orderBy: { position: "asc" },
        select: { id: true, name: true, position: true },
      },
      channels: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          topic: true,
          type: true,
          categoryId: true,
          position: true,
          isPrivate: true,
          isTemporary: true,
          jogo: true,
          criadaPor: true,
          userLimit: true,
        },
      },
      roles: {
        orderBy: { position: "desc" },
        select: {
          id: true,
          name: true,
          color: true,
          position: true,
          isDefault: true,
          isOwner: true,
          permissions: true,
          jogoVinculado: true,
        },
      },
      members: {
        orderBy: { joinedAt: "asc" },
        select: {
          id: true,
          nickname: true,
          joinedAt: true,
          user: {
            select: SELECT_USUARIO_PUBLICO,
          },
          roles: {
            select: {
              role: {
                select: {
                  id: true,
                  name: true,
                  color: true,
                  position: true,
                  isDefault: true,
                  isOwner: true,
                  permissions: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!server) return null;

  const channelsByCategory = new Map<string, PublicChannel[]>();
  const looseChannels: PublicChannel[] = [];
  const channelPermissions: Record<string, string> = {};

  for (const channel of server.channels) {
    const bits = permissionMap.get(channel.id) ?? 0n;
    // sem VIEW_CHANNEL o canal simplesmente nao existe para este visitante
    if (!has(bits, "VIEW_CHANNEL")) continue;
    channelPermissions[channel.id] = bits.toString();

    const publicChannel = toPublicChannel(channel);
    if (!channel.categoryId) {
      looseChannels.push(publicChannel);
      continue;
    }
    const list = channelsByCategory.get(channel.categoryId) ?? [];
    list.push(publicChannel);
    channelsByCategory.set(channel.categoryId, list);
  }

  const categories: PublicCategory[] = server.categories.map((category) => ({
    id: category.id,
    name: category.name,
    position: category.position,
    channels: channelsByCategory.get(category.id) ?? [],
  }));

  const members: PublicMember[] = server.members.map((member) => ({
    id: member.id,
    nickname: member.nickname,
    joinedAt: member.joinedAt.toISOString(),
    user: toPublicUser(member.user),
    roles: member.roles
      .map(({ role }) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
        isDefault: role.isDefault,
        isOwner: role.isOwner,
        // bigint nao e serializavel para o client component
        permissions: role.permissions.toString(),
      }))
      .sort((a, b) => b.position - a.position),
  }));

  return {
    server: {
      id: server.id,
      name: server.name,
      iconUrl: server.iconUrl,
      ownerId: server.ownerId,
      memberCount: server._count.members,
    },
    categories,
    looseChannels,
    members,
    channelPermissions,
    roles: server.roles.map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color,
      position: role.position,
      isDefault: role.isDefault,
      isOwner: role.isOwner,
      permissions: role.permissions.toString(),
      jogoVinculado: role.jogoVinculado,
    })),
    cargoPorJogo: server.cargoPorJogo,
    salasDeGrupo: server.salasDeGrupo,
  };
}

/**
 * Grava a ordem do trilho desta pessoa.
 *
 * Recebe a lista INTEIRA e regrava todas as posicoes como 0..n, em vez de
 * mover um item. Idempotente: mandar a mesma lista duas vezes da no mesmo, e
 * uma reordenacao concorrente na outra aba nao deixa buracos nem empates.
 *
 * Ids desconhecidos sao IGNORADOS em vez de darem erro: a lista chega do
 * navegador, e alguem que saiu de um servidor noutra aba mandaria um id que
 * nao existe mais. Recusar a operacao inteira por causa disso perderia a
 * reordenacao legitima dos outros.
 */
export async function reorderServers(
  userId: string,
  orderedServerIds: string[],
): Promise<void> {
  const meus = await prisma.serverMember.findMany({
    where: { userId },
    select: { id: true, serverId: true },
  });
  const porServidor = new Map(meus.map((m) => [m.serverId, m.id]));

  const updates = orderedServerIds
    .map((serverId, indice) => ({ memberId: porServidor.get(serverId), indice }))
    .filter((item): item is { memberId: string; indice: number } =>
      Boolean(item.memberId),
    );

  await prisma.$transaction(
    updates.map(({ memberId, indice }) =>
      prisma.serverMember.update({
        where: { id: memberId },
        data: { position: indice },
      }),
    ),
  );
}
