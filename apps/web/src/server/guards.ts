import "server-only";

import { cache } from "react";
import { prisma } from "@aether/db";
import { has, type PermissionKey } from "@aether/shared";
import {
  canActOnUser,
  getChannelPermissions,
  loadMemberAccess,
  type MemberAccess,
} from "@aether/access";
import { getSession, type AuthenticatedSession } from "./auth/session";

/**
 * Guards de autorizacao. TODA leitura ou escrita que dependa de servidor/canal
 * passa por aqui. Nenhuma permissao chega do cliente — ela e sempre recalculada
 * a partir dos cargos gravados no banco.
 */

export class AuthError extends Error {
  constructor(message = "Nao autenticado") {
    super(message);
    this.name = "AuthError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Sem permissao para esta acao") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Recurso nao encontrado") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Exige usuario autenticado. */
export async function requireUser(): Promise<AuthenticatedSession> {
  const session = await getSession();
  if (!session) throw new AuthError();
  return session;
}

/**
 * O contexto do app web e o `MemberAccess` compartilhado mais a sessao HTTP.
 * Estender em vez de repetir os campos garante que o gateway realtime e o web
 * calculem permissao a partir da mesma forma de dado — se um dia a forma mudar,
 * muda nos dois ao mesmo tempo ou nao compila.
 */
export interface MemberContext extends MemberAccess {
  session: AuthenticatedSession;
}

/**
 * Carrega o membro e calcula permissoes efetivas (uniao dos cargos).
 * Memoizado por request: varios componentes da mesma pagina reutilizam.
 */
export const getMemberContext = cache(
  async (serverId: string): Promise<MemberContext | null> => {
    const session = await getSession();
    if (!session) return null;

    const access = await loadMemberAccess(serverId, session.user.id);
    if (!access) return null;

    return { ...access, session };
  },
);

/** Exige que o usuario seja membro do servidor. Bloqueia acesso indevido. */
export async function requireMember(serverId: string): Promise<MemberContext> {
  const session = await getSession();
  if (!session) throw new AuthError();

  const context = await getMemberContext(serverId);
  if (!context) {
    // Nao revelamos se o servidor existe: para quem nao e membro, nao existe.
    throw new NotFoundError("Servidor nao encontrado");
  }
  return context;
}

/** Exige uma permissao especifica no servidor. */
export async function requirePermission(
  serverId: string,
  permission: PermissionKey,
): Promise<MemberContext> {
  const context = await requireMember(serverId);
  if (!has(context.permissions, permission)) {
    throw new ForbiddenError();
  }
  return context;
}

/**
 * Exige uma permissao DENTRO de um canal especifico, ja com os overwrites
 * aplicados. Tambem garante que o canal pertence ao servidor — sem isso,
 * bastaria trocar o id na URL para agir em canal de outro servidor.
 */
export async function requireChannelPermission(
  serverId: string,
  channelId: string,
  permission: PermissionKey,
): Promise<MemberContext> {
  const context = await requireMember(serverId);
  const bits = await getChannelPermissions(context, channelId);
  if (bits === null) throw new NotFoundError("Canal nao encontrado");
  if (!has(bits, permission)) throw new ForbiddenError();
  return context;
}

/**
 * Hierarquia de cargos: so se mexe em cargo estritamente abaixo do seu.
 * O cargo do dono e intocavel para todos, inclusive para o proprio dono.
 */
export async function assertRoleHierarchy(
  actor: MemberContext,
  roleId: string,
): Promise<{ position: number }> {
  const role = await prisma.role.findFirst({
    where: { id: roleId, serverId: actor.serverId },
    select: { position: true, isOwner: true },
  });
  if (!role) throw new NotFoundError("Cargo nao encontrado");
  if (role.isOwner) {
    throw new ForbiddenError("O cargo do dono nao pode ser alterado");
  }
  if (actor.isOwner) return { position: role.position };
  if (role.position >= actor.highestRolePosition) {
    throw new ForbiddenError(
      "Voce so pode gerenciar cargos abaixo do seu na hierarquia",
    );
  }
  return { position: role.position };
}

/**
 * Hierarquia: um membro so pode agir sobre alguem com cargo mais baixo.
 * O dono age sobre todos; ninguem age sobre o dono.
 */
export async function assertHierarchy(
  actor: MemberContext,
  targetMemberId: string,
): Promise<void> {
  if (actor.memberId === targetMemberId) return;

  const target = await prisma.serverMember.findUnique({
    where: { id: targetMemberId },
    select: { serverId: true, userId: true },
  });
  if (!target || target.serverId !== actor.serverId) {
    throw new NotFoundError("Membro nao encontrado");
  }

  /**
   * A regra em si vive em @aether/access porque o gateway tambem precisa dela
   * (moderacao de voz). Aqui so traduzimos "membro" para "usuario" e
   * convertemos a resposta em excecao, que e o contrato das actions.
   */
  if (!(await canActOnUser(actor, target.userId))) {
    throw new ForbiddenError(
      "Voce so pode agir sobre membros de cargo abaixo do seu",
    );
  }
}
