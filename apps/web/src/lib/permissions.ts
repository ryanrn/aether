import { has, type PermissionKey } from "@aether/shared";
import type { ChannelPermissionMap, ViewerContext } from "@aether/shared";

/**
 * Helpers de permissao SEGUROS PARA O CLIENTE.
 *
 * Eles decidem apenas o que aparece na tela. Nenhuma decisao real de acesso
 * mora aqui — o servidor recalcula tudo em cada action. Se alguem forjar o
 * estado do cliente, no maximo ve um botao que nao funciona.
 */

export function viewerCan(viewer: ViewerContext, permission: PermissionKey): boolean {
  if (viewer.isOwner) return true;
  return has(BigInt(viewer.permissions), permission);
}

export function channelAllows(
  map: ChannelPermissionMap,
  channelId: string,
  permission: PermissionKey,
): boolean {
  const raw = map[channelId];
  if (!raw) return false;
  return has(BigInt(raw), permission);
}

/** Um cargo so pode ser editado por quem esta acima dele na hierarquia. */
export function canManageRole(
  viewer: ViewerContext,
  role: { position: number; isOwner: boolean },
): boolean {
  if (role.isOwner) return false;
  if (viewer.isOwner) return true;
  if (!viewerCan(viewer, "MANAGE_ROLES")) return false;
  return role.position < viewer.highestRolePosition;
}
