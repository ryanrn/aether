import { prisma } from "@aether/db";
import { ALL_PERMISSIONS, type PermissionBits } from "@aether/shared";

/**
 * Contexto minimo para decidir permissao.
 *
 * De proposito NAO carrega a sessao HTTP: o gateway autentica uma vez no
 * handshake e depois so precisa saber quem e o membro e quais cargos ele tem.
 * O `MemberContext` do app web estende esta interface acrescentando a sessao,
 * entao tudo que aceita `MemberAccess` aceita tambem o contexto do web.
 */
export interface MemberAccess {
  serverId: string;
  memberId: string;
  isOwner: boolean;
  /** permissoes efetivas no nivel do servidor (uniao dos cargos) */
  permissions: PermissionBits;
  /** maior position entre os cargos do membro — usado na hierarquia */
  highestRolePosition: number;
  roleIds: string[];
}

/**
 * Carrega o membro e calcula as permissoes de servidor a partir dos cargos
 * gravados no banco. Retorna `null` quando o usuario nao e membro — quem chama
 * decide se isso vira 404 (web) ou recusa de handshake (gateway).
 *
 * Nao ha memoizacao aqui de proposito: o app web embrulha esta funcao no
 * `cache()` do React (escopo de request) e o gateway mantem o resultado na
 * conexao. Cachear no lugar errado seria guardar permissao velha.
 */
export async function loadMemberAccess(
  serverId: string,
  userId: string,
): Promise<MemberAccess | null> {
  const member = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId } },
    include: {
      server: { select: { ownerId: true } },
      roles: {
        include: {
          role: { select: { id: true, permissions: true, position: true } },
        },
      },
    },
  });

  if (!member) return null;

  const isOwner = member.server.ownerId === userId;

  let permissions = 0n;
  let highest = 0;
  const roleIds: string[] = [];
  for (const link of member.roles) {
    permissions |= link.role.permissions;
    highest = Math.max(highest, link.role.position);
    roleIds.push(link.role.id);
  }
  if (isOwner) {
    permissions = ALL_PERMISSIONS;
    highest = Number.MAX_SAFE_INTEGER;
  }

  return {
    serverId,
    memberId: member.id,
    isOwner,
    permissions,
    highestRolePosition: highest,
    roleIds,
  };
}

/**
 * Hierarquia: quem pode agir sobre quem.
 *
 * Mora aqui, e nao no app web, porque a partir da moderacao de voz o GATEWAY
 * tambem precisa dessa resposta — silenciar alguem de cargo superior tem de
 * ser recusado no mesmo lugar em que expulsar e recusado. Duas copias da regra
 * divergem, e hierarquia divergente e escalada de privilegio.
 *
 * Regras, iguais as da fase 2:
 *  - o dono do servidor e intocavel, inclusive para ele mesmo;
 *  - o dono age sobre todos os demais;
 *  - os outros so agem sobre cargo ESTRITAMENTE abaixo do seu.
 */
export async function canActOnUser(
  actor: MemberAccess,
  targetUserId: string,
): Promise<boolean> {
  const target = await prisma.serverMember.findUnique({
    where: {
      serverId_userId: { serverId: actor.serverId, userId: targetUserId },
    },
    include: {
      server: { select: { ownerId: true } },
      roles: { include: { role: { select: { position: true } } } },
    },
  });
  if (!target) return false;

  if (target.server.ownerId === targetUserId) return false;
  if (actor.isOwner) return true;

  const targetHighest = target.roles.reduce(
    (max, link) => Math.max(max, link.role.position),
    0,
  );
  return targetHighest < actor.highestRolePosition;
}
