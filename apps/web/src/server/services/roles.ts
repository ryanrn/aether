import "server-only";

import { prisma } from "@aether/db";
import {
  combine,
  type PermissionBits,
  type PermissionKey,
} from "@aether/shared";

/**
 * Camada de dados de cargos.
 *
 * Hierarquia: `position` maior = cargo mais alto. Quem chama garante, via
 * assertRoleHierarchy (guards.ts), que o ator esta acima do cargo alvo.
 */

/** Permissoes de um cargo recem-criado: as mesmas de um membro comum. */
const NEW_ROLE_PERMISSIONS = combine("VIEW_CHANNEL", "CONNECT", "SPEAK", "SEND_MESSAGES");

export async function createRole(params: {
  serverId: string;
  name: string;
  color: string;
  /** posicao do cargo mais alto de quem esta criando (o novo entra abaixo) */
  ceilingPosition: number;
}): Promise<{ roleId: string }> {
  const highest = await prisma.role.findFirst({
    where: { serverId: params.serverId, isOwner: false },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  // o novo cargo nunca nasce acima de quem o criou
  const desired = (highest?.position ?? 0) + 1;
  const position = Math.max(
    1,
    Math.min(desired, Math.max(1, params.ceilingPosition - 1)),
  );

  const role = await prisma.role.create({
    data: {
      serverId: params.serverId,
      name: params.name,
      color: params.color,
      permissions: NEW_ROLE_PERMISSIONS,
      position,
    },
    select: { id: true },
  });
  return { roleId: role.id };
}

export async function updateRole(params: {
  roleId: string;
  serverId: string;
  name: string;
  color: string;
  permissions: PermissionKey[];
  /** permissoes que o ator possui — ninguem concede o que nao tem */
  actorPermissions: PermissionBits;
  actorIsOwner: boolean;
}): Promise<void> {
  const role = await prisma.role.findFirst({
    where: { id: params.roleId, serverId: params.serverId },
    select: { id: true, isOwner: true, permissions: true },
  });
  if (!role) throw new Error("Cargo nao encontrado");
  if (role.isOwner) throw new Error("O cargo do dono nao pode ser editado");

  let desired = combine(...params.permissions);

  /**
   * Escalada de privilegio: um moderador nao pode criar um cargo com poderes
   * que ele proprio nao tem. Mantemos os bits que o cargo JA possuia (para nao
   * remover silenciosamente algo fora do alcance do ator) e limitamos as
   * adicoes ao que o ator possui.
   */
  if (!params.actorIsOwner) {
    const added = desired & ~role.permissions;
    const allowedAdditions = added & params.actorPermissions;
    desired = (role.permissions & desired) | allowedAdditions;
  }

  await prisma.role.update({
    where: { id: params.roleId },
    data: { name: params.name, color: params.color, permissions: desired },
  });
}

export async function deleteRole(roleId: string, serverId: string): Promise<void> {
  const role = await prisma.role.findFirst({
    where: { id: roleId, serverId },
    select: { id: true, isOwner: true, isDefault: true },
  });
  if (!role) throw new Error("Cargo nao encontrado");
  if (role.isOwner) throw new Error("O cargo do dono nao pode ser excluido");
  if (role.isDefault) throw new Error("O cargo padrao nao pode ser excluido");

  await prisma.role.delete({ where: { id: roleId } });
}

export async function assignRole(
  memberId: string,
  roleId: string,
  serverId: string,
): Promise<void> {
  const [member, role] = await Promise.all([
    prisma.serverMember.findFirst({
      where: { id: memberId, serverId },
      select: { id: true },
    }),
    prisma.role.findFirst({
      where: { id: roleId, serverId },
      select: { id: true, isOwner: true },
    }),
  ]);
  if (!member || !role) throw new Error("Membro ou cargo invalido");
  if (role.isOwner) throw new Error("O cargo do dono nao pode ser atribuido");

  await prisma.memberRole.upsert({
    where: { memberId_roleId: { memberId, roleId } },
    create: { memberId, roleId },
    update: {},
  });
}

export async function unassignRole(
  memberId: string,
  roleId: string,
  serverId: string,
): Promise<void> {
  const role = await prisma.role.findFirst({
    where: { id: roleId, serverId },
    select: { id: true, isOwner: true, isDefault: true },
  });
  if (!role) throw new Error("Cargo invalido");
  if (role.isOwner) throw new Error("O cargo do dono nao pode ser removido");
  if (role.isDefault) throw new Error("O cargo padrao nao pode ser removido");

  await prisma.memberRole.deleteMany({ where: { memberId, roleId } });
}
