"use server";

import { revalidatePath } from "next/cache";
import {
  assignRoleSchema,
  createRoleSchema,
  updateRoleSchema,
  type ActionResult,
} from "@aether/shared";
import { writeAudit } from "../audit";
import {
  assertHierarchy,
  assertRoleHierarchy,
  requirePermission,
} from "../guards";
import { resyncGatewayRooms } from "../realtime-notify";
import {
  assignRole,
  createRole,
  deleteRole,
  unassignRole,
  updateRole,
} from "../services/roles";
import { fail, ok, toActionError } from "./action-result";

/**
 * Actions de cargos.
 *
 * Duas travas alem da permissao MANAGE_ROLES:
 *  1. hierarquia — so se edita cargo abaixo do seu (assertRoleHierarchy);
 *  2. escalada — nao se concede permissao que voce mesmo nao tem
 *     (tratado dentro de updateRole).
 */

function refresh(serverId: string) {
  revalidatePath(`/app/s/${serverId}`, "layout");
}

export async function createRoleAction(
  input: unknown,
): Promise<ActionResult<{ roleId: string }>> {
  try {
    const parsed = createRoleSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(issue?.message ?? "Dados invalidos", String(issue?.path[0] ?? ""));
    }

    const context = await requirePermission(parsed.data.serverId, "MANAGE_ROLES");

    const result = await createRole({
      serverId: parsed.data.serverId,
      name: parsed.data.name,
      color: parsed.data.color,
      ceilingPosition: context.isOwner
        ? Number.MAX_SAFE_INTEGER
        : context.highestRolePosition,
    });

    await writeAudit({
      serverId: parsed.data.serverId,
      actorId: context.session.user.id,
      action: "role.create",
      targetType: "role",
      targetId: result.roleId,
      metadata: { name: parsed.data.name },
    });

    refresh(parsed.data.serverId);
    return ok(result);
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateRoleAction(
  serverId: string,
  input: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const parsed = updateRoleSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(issue?.message ?? "Dados invalidos", String(issue?.path[0] ?? ""));
    }

    const context = await requirePermission(serverId, "MANAGE_ROLES");
    await assertRoleHierarchy(context, parsed.data.roleId);

    await updateRole({
      roleId: parsed.data.roleId,
      serverId,
      name: parsed.data.name,
      color: parsed.data.color,
      permissions: parsed.data.permissions,
      actorPermissions: context.permissions,
      actorIsOwner: context.isOwner,
    });
    // Quem tem este cargo pode ter ganhado ou perdido VIEW_CHANNEL de algum
    // canal — recalcula quem ja esta conectado, nao so quem entrar depois.
    await resyncGatewayRooms({ serverId });

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "role.update",
      targetType: "role",
      targetId: parsed.data.roleId,
      metadata: { name: parsed.data.name, permissions: parsed.data.permissions },
    });

    refresh(serverId);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteRoleAction(
  serverId: string,
  roleId: string,
): Promise<ActionResult<undefined>> {
  try {
    const context = await requirePermission(serverId, "MANAGE_ROLES");
    await assertRoleHierarchy(context, roleId);

    await deleteRole(roleId, serverId);
    // Quem tinha este cargo perde as permissoes que so vinham dele.
    await resyncGatewayRooms({ serverId });

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "role.delete",
      targetType: "role",
      targetId: roleId,
    });

    refresh(serverId);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

export async function assignRoleAction(
  serverId: string,
  input: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const parsed = assignRoleSchema.safeParse(input);
    if (!parsed.success) return fail("Dados invalidos");

    const context = await requirePermission(serverId, "MANAGE_ROLES");
    // nao se mexe em membro de cargo igual ou superior...
    await assertHierarchy(context, parsed.data.memberId);
    // ...nem se entrega um cargo acima do seu
    await assertRoleHierarchy(context, parsed.data.roleId);

    await assignRole(parsed.data.memberId, parsed.data.roleId, serverId);
    // O cargo novo pode abrir canal que o membro nao via ate agora.
    await resyncGatewayRooms({ serverId });

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "role.update",
      targetType: "member",
      targetId: parsed.data.memberId,
      metadata: { assigned: parsed.data.roleId },
    });

    refresh(serverId);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}

export async function unassignRoleAction(
  serverId: string,
  input: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const parsed = assignRoleSchema.safeParse(input);
    if (!parsed.success) return fail("Dados invalidos");

    const context = await requirePermission(serverId, "MANAGE_ROLES");
    await assertHierarchy(context, parsed.data.memberId);
    await assertRoleHierarchy(context, parsed.data.roleId);

    await unassignRole(parsed.data.memberId, parsed.data.roleId, serverId);
    // Perder o cargo pode fechar canal que so era visivel por causa dele.
    await resyncGatewayRooms({ serverId });

    await writeAudit({
      serverId,
      actorId: context.session.user.id,
      action: "role.update",
      targetType: "member",
      targetId: parsed.data.memberId,
      metadata: { removed: parsed.data.roleId },
    });

    refresh(serverId);
    return ok();
  } catch (error) {
    return toActionError(error);
  }
}
