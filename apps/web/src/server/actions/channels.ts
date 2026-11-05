"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@aether/db";
import {
  createCategorySchema,
  createChannelSchema,
  renameCategorySchema,
  updateChannelSchema,
  channelAccessSchema,
  type ActionResult,
} from "@aether/shared";
import { writeAudit } from "../audit";
import {
  assertRoleHierarchy,
  requireChannelPermission,
  requirePermission,
} from "../guards";
import { avisarArvoreMudou, resyncGatewayRooms } from "../realtime-notify";
import {
  createCategory,
  createChannel,
  deleteCategory,
  deleteChannel,
  getChannelAccess,
  moveChannel,
  reorderChannel,
  renameCategory,
  setChannelAccess,
  updateChannel,
} from "../services/channels";
import { fail, ok, toActionError } from "./action-result";

/**
 * Actions de canais e categorias.
 *
 * Todas seguem o mesmo contrato: guard primeiro (que ja valida se o recurso
 * pertence ao servidor), depois Zod, depois service, depois auditoria.
 * O cliente nunca informa quem ele e — isso vem do cookie.
 */

function refresh(serverId: string) {
  revalidatePath(`/app/s/${serverId}`, "layout");
}

export async function createChannelAction(
  input: unknown,
): Promise<ActionResult<{ channelId: string }>> {
  try {
    const parsed = createChannelSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(issue?.message ?? "Dados invalidos", String(issue?.path[0] ?? ""));
    }
    const data = parsed.data;

    const context = await requirePermission(data.serverId, "CREATE_CHANNEL");

    const result = await createChannel({
      serverId: data.serverId,
      name: data.name,
      type: data.type,
      categoryId: data.categoryId,
      isPrivate: data.isPrivate,
      isTemporary: data.isTemporary,
      userLimit: data.userLimit,
      allowedRoleIds: data.isPrivate ? data.allowedRoleIds : [],
    });
    // Canal novo: quem ja esta conectado no servidor nao tinha essa sala ainda.
    await resyncGatewayRooms({ serverId: data.serverId });

    await writeAudit({
      serverId: data.serverId,
      actorId: context.session.user.id,
      action: "channel.create",
      targetType: "channel",
      targetId: result.channelId,
      metadata: { name: data.name, type: data.type, isPrivate: data.isPrivate },
    });

    refresh(data.serverId);
    return ok(result);
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateChannelAction(
  serverId: string,
  input: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const parsed = updateChannelSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(issue?.message ?? "Dados invalidos", String(issue?.path[0] ?? ""));
    }
    const data = parsed.data;

    const context = await requireChannelPermission(
      serverId,
      data.channelId,
      "EDIT_CHANNEL",
    );

    await updateChannel({ ...data, serverId });
    // isPrivate pode ter mudado, e o servico limpa os overwrites quando o
    // canal deixa de ser privado — os dois alteram quem enxerga o canal.
    await resyncGatewayRooms({ serverId });

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "channel.update",
      targetType: "channel",
      targetId: data.channelId,
      metadata: { name: data.name },
    });

    refresh(serverId);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteChannelAction(
  serverId: string,
  channelId: string,
): Promise<ActionResult<undefined>> {
  try {
    const context = await requireChannelPermission(
      serverId,
      channelId,
      "DELETE_CHANNEL",
    );

    const channel = await prisma.channel.findFirst({
      where: { id: channelId, serverId },
      select: { name: true },
    });

    await deleteChannel(channelId, serverId);
    // Alem de atualizar a arvore, tira todo mundo da sala do canal que sumiu
    // — inclusive de dentro da call, se for um canal de voz (canalExcluidoId).
    await resyncGatewayRooms({ serverId, canalExcluidoId: channelId });

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "channel.delete",
      targetType: "channel",
      targetId: channelId,
      metadata: { name: channel?.name ?? null },
    });

    refresh(serverId);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

export async function moveChannelAction(
  serverId: string,
  channelId: string,
  direction: "up" | "down",
): Promise<ActionResult<undefined>> {
  try {
    await requireChannelPermission(serverId, channelId, "EDIT_CHANNEL");
    await moveChannel(channelId, serverId, direction);
    /**
     * Ordem e cosmetica (as setas nunca trocam de categoria): a arvore de todo
     * mundo precisa refletir, mas ninguem passa a ver ou deixar de ver nada —
     * so o aviso, sem o recalculo de salas.
     */
    await avisarArvoreMudou({ serverId });
    refresh(serverId);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

export async function setChannelAccessAction(
  serverId: string,
  input: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const parsed = channelAccessSchema.safeParse(input);
    if (!parsed.success) return fail("Dados invalidos");

    const context = await requireChannelPermission(
      serverId,
      parsed.data.channelId,
      "EDIT_CHANNEL",
    );

    /**
     * EDIT_CHANNEL sozinho nao bastava aqui: sem isto, quem tem essa
     * permissao mas nao MANAGE_ROLES conseguia liberar um canal privado pra
     * QUALQUER cargo do servidor, inclusive um de posicao ACIMA da propria —
     * exatamente o tipo de furo de hierarquia que `assertRoleHierarchy` ja
     * impede em outras acoes (atribuir cargo a um membro, por exemplo). O
     * alcance concedido continua limitado a `PRIVATE_ACCESS_ALLOW`, mas
     * mesmo so isso e informacao/participacao que nao deveria vazar assim.
     */
    for (const roleId of parsed.data.roleIds) {
      await assertRoleHierarchy(context, roleId);
    }

    await setChannelAccess(parsed.data.channelId, serverId, parsed.data.roleIds);
    // A lista de cargos liberados neste canal privado mudou por inteiro.
    await resyncGatewayRooms({ serverId });

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "channel.update",
      targetType: "channel",
      targetId: parsed.data.channelId,
      metadata: { access: parsed.data.roleIds.length },
    });

    refresh(serverId);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

export async function createCategoryAction(
  input: unknown,
): Promise<ActionResult<{ categoryId: string }>> {
  try {
    const parsed = createCategorySchema.safeParse(input);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Dados invalidos", "name");
    }

    const context = await requirePermission(parsed.data.serverId, "CREATE_CHANNEL");
    const result = await createCategory(parsed.data.serverId, parsed.data.name);
    await resyncGatewayRooms({ serverId: parsed.data.serverId });

    await writeAudit({
      serverId: parsed.data.serverId,
      actorId: context.session.user.id,
      action: "channel.create",
      targetType: "category",
      targetId: result.categoryId,
      metadata: { name: parsed.data.name },
    });

    refresh(parsed.data.serverId);
    return ok(result);
  } catch (error) {
    return toActionError(error);
  }
}

export async function renameCategoryAction(
  serverId: string,
  input: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const parsed = renameCategorySchema.safeParse(input);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Dados invalidos", "name");
    }

    await requirePermission(serverId, "EDIT_CHANNEL");
    await renameCategory(parsed.data.categoryId, serverId, parsed.data.name);
    await resyncGatewayRooms({ serverId });

    refresh(serverId);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteCategoryAction(
  serverId: string,
  categoryId: string,
): Promise<ActionResult<undefined>> {
  try {
    const context = await requirePermission(serverId, "DELETE_CHANNEL");
    await deleteCategory(categoryId, serverId);
    // Os canais viram soltos (onDelete: SetNull) — a arvore muda para todos.
    await resyncGatewayRooms({ serverId });

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "channel.delete",
      targetType: "category",
      targetId: categoryId,
    });

    refresh(serverId);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

/** Usado pelo modal de edicao para pre-carregar os dados do canal. */
export async function getChannelForEditAction(
  serverId: string,
  channelId: string,
): Promise<
  ActionResult<{
    id: string;
    name: string;
    topic: string | null;
    categoryId: string | null;
    isPrivate: boolean;
    isTemporary: boolean;
    userLimit: number | null;
    type: "TEXT" | "VOICE";
    allowedRoleIds: string[];
  }>
> {
  try {
    await requireChannelPermission(serverId, channelId, "EDIT_CHANNEL");

    const channel = await prisma.channel.findFirst({
      where: { id: channelId, serverId },
      select: {
        id: true,
        name: true,
        topic: true,
        categoryId: true,
        isPrivate: true,
        isTemporary: true,
        userLimit: true,
        type: true,
      },
    });
    if (!channel) return fail("Canal nao encontrado");

    const allowedRoleIds = await getChannelAccess(channelId, serverId);
    return ok({ ...channel, allowedRoleIds });
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Reordena um canal por ARRASTO: nova categoria e novo indice.
 *
 * Mesma permissao do mover por setas (`EDIT_CHANNEL` no canal arrastado), e
 * nao uma nova: e a mesma acao com outro gesto. Quem nao podia mover pelas
 * setas tambem nao move arrastando — o servidor decide, e a tela so esconde o
 * que seria recusado.
 */
export async function reorderChannelAction(
  serverId: string,
  channelId: string,
  categoryId: string | null,
  index: unknown,
): Promise<ActionResult<undefined>> {
  try {
    await requireChannelPermission(serverId, channelId, "EDIT_CHANNEL");

    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      return fail("Posicao invalida.");
    }

    const { mudouDeCategoria } = await reorderChannel({
      serverId,
      channelId,
      categoryId,
      index,
    });
    /**
     * Mudar de CATEGORIA pode mexer no que cada pessoa enxerga (categoria
     * privada): recalculo completo das salas. Na MESMA categoria so a ordem
     * muda — basta o aviso, que e o que deixava o arraste lento (~3 s).
     */
    if (mudouDeCategoria) await resyncGatewayRooms({ serverId });
    else await avisarArvoreMudou({ serverId });
    refresh(serverId);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}
