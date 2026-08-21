import "server-only";

import { prisma, type ChannelType } from "@aether/db";
import { combine } from "@aether/shared";

/**
 * Camada de dados de canais e categorias.
 * Sem checagem de sessao aqui: quem chama ja passou pelos guards.
 */

/**
 * Permissoes concedidas a um cargo liberado num canal privado.
 * Guardamos como ALLOW explicito: e o allow que torna o canal visivel para
 * aquele cargo (ver getChannelPermissionMap).
 */
const PRIVATE_ACCESS_ALLOW = combine(
  "VIEW_CHANNEL",
  "CONNECT",
  "SPEAK",
  "SCREEN_SHARE",
  "SEND_MESSAGES",
);

async function nextPosition(
  serverId: string,
  categoryId: string | null,
): Promise<number> {
  const last = await prisma.channel.findFirst({
    where: { serverId, categoryId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (last?.position ?? -1) + 1;
}

export async function createChannel(params: {
  serverId: string;
  name: string;
  type: ChannelType;
  categoryId: string | null;
  isPrivate: boolean;
  isTemporary: boolean;
  userLimit: number | null;
  /** cargos com acesso, quando o canal e privado */
  allowedRoleIds: string[];
}): Promise<{ channelId: string }> {
  // categoria precisa ser do mesmo servidor — nao confiamos no id que veio do form
  if (params.categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: params.categoryId, serverId: params.serverId },
      select: { id: true },
    });
    if (!category) throw new Error("Categoria invalida");
  }

  const position = await nextPosition(params.serverId, params.categoryId);

  const channel = await prisma.channel.create({
    data: {
      serverId: params.serverId,
      name: params.name,
      type: params.type,
      categoryId: params.categoryId,
      isPrivate: params.isPrivate,
      isTemporary: params.isTemporary,
      userLimit: params.type === "VOICE" ? params.userLimit : null,
      position,
    },
    select: { id: true },
  });

  if (params.isPrivate && params.allowedRoleIds.length > 0) {
    await setChannelAccess(channel.id, params.serverId, params.allowedRoleIds);
  }

  return { channelId: channel.id };
}

export async function updateChannel(params: {
  channelId: string;
  serverId: string;
  name: string;
  topic: string | null;
  categoryId: string | null;
  isPrivate: boolean;
  isTemporary: boolean;
  userLimit: number | null;
}): Promise<void> {
  const channel = await prisma.channel.findFirst({
    where: { id: params.channelId, serverId: params.serverId },
    select: { id: true, type: true, categoryId: true },
  });
  if (!channel) throw new Error("Canal nao encontrado");

  if (params.categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: params.categoryId, serverId: params.serverId },
      select: { id: true },
    });
    if (!category) throw new Error("Categoria invalida");
  }

  // mudou de categoria: vai para o fim da nova
  const position =
    params.categoryId === channel.categoryId
      ? undefined
      : await nextPosition(params.serverId, params.categoryId);

  await prisma.channel.update({
    where: { id: params.channelId },
    data: {
      name: params.name,
      topic: params.topic,
      categoryId: params.categoryId,
      isPrivate: params.isPrivate,
      isTemporary: params.isTemporary,
      userLimit: channel.type === "VOICE" ? params.userLimit : null,
      ...(position === undefined ? {} : { position }),
    },
  });

  // canal deixou de ser privado: os overwrites perdem sentido
  if (!params.isPrivate) {
    await prisma.channelOverwrite.deleteMany({
      where: { channelId: params.channelId },
    });
  }
}

export async function deleteChannel(
  channelId: string,
  serverId: string,
): Promise<void> {
  const result = await prisma.channel.deleteMany({
    where: { id: channelId, serverId },
  });
  if (result.count === 0) throw new Error("Canal nao encontrado");
}

/**
 * Move o canal uma posicao para cima ou para baixo dentro da categoria.
 *
 * Troca simples de posicoes em transacao. Escolhi isso em vez de arrastar-e-
 * soltar com indices fracionarios porque e deterministico e nao acumula erro
 * de ordenacao; se a fase 7 pedir drag and drop, a mesma coluna `position`
 * atende, so muda a forma de calcular o alvo.
 */
export async function moveChannel(
  channelId: string,
  serverId: string,
  direction: "up" | "down",
): Promise<void> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, serverId },
    select: { id: true, position: true, categoryId: true },
  });
  if (!channel) throw new Error("Canal nao encontrado");

  const neighbour = await prisma.channel.findFirst({
    where: {
      serverId,
      categoryId: channel.categoryId,
      position:
        direction === "up"
          ? { lt: channel.position }
          : { gt: channel.position },
    },
    orderBy: { position: direction === "up" ? "desc" : "asc" },
    select: { id: true, position: true },
  });
  if (!neighbour) return; // ja esta na ponta

  await prisma.$transaction([
    prisma.channel.update({
      where: { id: channel.id },
      data: { position: neighbour.position },
    }),
    prisma.channel.update({
      where: { id: neighbour.id },
      data: { position: channel.position },
    }),
  ]);
}

/** Define quais cargos enxergam um canal privado. Substitui a lista inteira. */
export async function setChannelAccess(
  channelId: string,
  serverId: string,
  roleIds: string[],
): Promise<void> {
  // so aceitamos cargos do proprio servidor
  const roles = await prisma.role.findMany({
    where: { id: { in: roleIds }, serverId },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.channelOverwrite.deleteMany({
      where: { channelId, target: "ROLE" },
    }),
    prisma.channelOverwrite.createMany({
      data: roles.map((role) => ({
        channelId,
        target: "ROLE" as const,
        roleId: role.id,
        allow: PRIVATE_ACCESS_ALLOW,
        deny: 0n,
      })),
    }),
  ]);
}

/** Cargos atualmente liberados num canal privado. */
export async function getChannelAccess(
  channelId: string,
  serverId: string,
): Promise<string[]> {
  const overwrites = await prisma.channelOverwrite.findMany({
    where: { channelId, target: "ROLE", channel: { serverId } },
    select: { roleId: true },
  });
  return overwrites
    .map((overwrite) => overwrite.roleId)
    .filter((id): id is string => id !== null);
}

export async function createCategory(
  serverId: string,
  name: string,
): Promise<{ categoryId: string }> {
  const last = await prisma.category.findFirst({
    where: { serverId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const category = await prisma.category.create({
    data: { serverId, name, position: (last?.position ?? -1) + 1 },
    select: { id: true },
  });
  return { categoryId: category.id };
}

export async function renameCategory(
  categoryId: string,
  serverId: string,
  name: string,
): Promise<void> {
  const result = await prisma.category.updateMany({
    where: { id: categoryId, serverId },
    data: { name },
  });
  if (result.count === 0) throw new Error("Categoria nao encontrada");
}

/**
 * Exclui a categoria. Os canais dentro dela NAO sao apagados: viram canais
 * soltos (o schema usa onDelete: SetNull). Apagar canais junto seria uma perda
 * de dados silenciosa a partir de um clique de organizacao.
 */
export async function deleteCategory(
  categoryId: string,
  serverId: string,
): Promise<void> {
  const result = await prisma.category.deleteMany({
    where: { id: categoryId, serverId },
  });
  if (result.count === 0) throw new Error("Categoria nao encontrada");
}
