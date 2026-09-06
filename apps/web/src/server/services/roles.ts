import "server-only";

import { prisma } from "@aether/db";
import {
  combine,
  GAME_NAME_MAX,
  normalizarNome,
  permissoesDeCargoDeJogo,
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
  /**
   * Jogo a vincular a este cargo (fase 2, estagio 2). `undefined` = nao mexe;
   * string vazia ou `null` = desvincula; string = vincula. Cargo com jogo
   * vinculado so pode carregar permissao de participacao — ver
   * PERMISSOES_DE_CARGO_DE_JOGO.
   */
  jogoVinculado?: string | null;
  /** permissoes que o ator possui — ninguem concede o que nao tem */
  actorPermissions: PermissionBits;
  actorIsOwner: boolean;
}): Promise<void> {
  const role = await prisma.role.findFirst({
    where: { id: params.roleId, serverId: params.serverId },
    select: {
      id: true,
      isOwner: true,
      isDefault: true,
      permissions: true,
      jogoNormalizado: true,
    },
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

  /**
   * Vinculo com jogo. `undefined` deixa como esta — as telas antigas nem
   * mandam o campo. A normalizacao e a MESMA do gateway (`@aether/shared`), que
   * casa contra `jogoNormalizado` a cada `presence:game`.
   */
  let jogoVinculado: string | null | undefined;
  let jogoNormalizado: string | null | undefined;
  if (params.jogoVinculado !== undefined) {
    if (role.isDefault) {
      throw new Error(
        "O cargo padrao nao pode ser vinculado a um jogo — todo mundo o tem.",
      );
    }
    const bruto = (params.jogoVinculado ?? "").trim().slice(0, GAME_NAME_MAX);
    const norm = bruto ? normalizarNome(bruto) : "";
    jogoVinculado = norm ? bruto : null;
    jogoNormalizado = norm || null;
  }

  /**
   * Cargo por jogo e pego dizendo "jogo X" — texto de cliente nao verificado.
   * Entao ele so pode dar acesso a estar na sala, nunca moderacao nem convite.
   * A mascara vem DEPOIS da guarda de escalada, para valer inclusive contra o
   * dono. Vale sobre o estado FINAL: se o cargo ja tinha jogo e nao esta sendo
   * desvinculado agora, tambem clampa.
   */
  const temJogoAoFim =
    jogoNormalizado !== undefined
      ? jogoNormalizado !== null
      : Boolean(role.jogoNormalizado);
  if (temJogoAoFim) desired = permissoesDeCargoDeJogo(desired);

  await prisma.role.update({
    where: { id: params.roleId },
    data: {
      name: params.name,
      color: params.color,
      permissions: desired,
      ...(jogoNormalizado !== undefined ? { jogoVinculado, jogoNormalizado } : {}),
    },
  });

  /**
   * Mudou o jogo do cargo (vinculou, desvinculou ou trocou): zera quem tinha o
   * cargo. Membros sao gerados pelo gateway a partir de quem esta jogando — um
   * recomeco limpo e previsivel, e o gateway readiciona quem esta com o jogo
   * aberto no proximo `presence:game` (segundos). Quem chama faz o
   * `resyncGatewayRooms` depois.
   */
  if (
    jogoNormalizado !== undefined &&
    jogoNormalizado !== (role.jogoNormalizado ?? null)
  ) {
    await prisma.memberRole.deleteMany({ where: { roleId: params.roleId } });
  }
}

/**
 * Liga ou desliga o cargo automatico por jogo no servidor (fase 2, estagio 2).
 *
 * Ao DESLIGAR, tira de todo mundo os cargos que eram atribuidos por jogo: sem
 * isso, quem estava jogando na hora do desligamento ficaria com o cargo para
 * sempre (o gateway so mexe quando o jogo muda, e ele para de mexer com o
 * recurso desligado). O vinculo do cargo (`jogoNormalizado`) fica — religar
 * volta a valer sem reconfigurar.
 */
export async function definirCargoPorJogo(
  serverId: string,
  ligado: boolean,
): Promise<void> {
  await prisma.server.update({
    where: { id: serverId },
    data: { cargoPorJogo: ligado },
  });

  if (!ligado) {
    await prisma.memberRole.deleteMany({
      where: { role: { serverId, jogoNormalizado: { not: null } } },
    });
  }
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
      select: { id: true, isOwner: true, jogoNormalizado: true },
    }),
  ]);
  if (!member || !role) throw new Error("Membro ou cargo invalido");
  if (role.isOwner) throw new Error("O cargo do dono nao pode ser atribuido");
  if (role.jogoNormalizado) {
    // Gerido pelo gateway a partir de quem esta jogando — nao se atribui na mao.
    throw new Error("Cargo automatico por jogo nao pode ser atribuido a mao");
  }

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
