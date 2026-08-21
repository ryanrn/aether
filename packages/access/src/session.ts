import { prisma } from "@aether/db";
import type { PublicUser, UserStatus } from "@aether/shared";
import { verifySessionToken } from "./tokens";

/**
 * Resolucao de sessao a partir de um token — sem nenhuma dependencia de HTTP.
 *
 * Sessao = JWT assinado + linha `Session` no banco. O JWT sozinho seria mais
 * barato, mas nao permite revogar acesso; com a linha no banco conseguimos
 * logout global, derrubar sessao apos ban e invalidar tudo na troca de senha.
 *
 * Quem entrega o token e problema de quem chama: o app web le do cookie
 * httpOnly, o gateway realtime le do cookie enviado no handshake WebSocket.
 * A validacao — assinatura, revogacao, expiracao, dono do token — e a mesma
 * para os dois, e mora aqui.
 */

export interface AuthenticatedSession {
  sessionId: string;
  user: PublicUser & { email: string };
}

export async function resolveSessionToken(
  token: string | null | undefined,
): Promise<AuthenticatedSession | null> {
  if (!token) return null;

  const claims = await verifySessionToken(token);
  if (!claims) return null;

  return loadSession(claims.sid, claims.sub);
}

/**
 * Carrega e valida a sessao pela linha do banco.
 *
 * Separado de `resolveSessionToken` porque existe mais de uma forma de provar
 * quem voce e — cookie de sessao e ticket de socket — e as duas terminam na
 * MESMA validacao: linha existe, nao revogada, nao expirada, e pertence a quem
 * o portador diz ser. Duplicar essa checagem seria criar um caminho onde
 * revogar login deixa de funcionar.
 */
export async function loadSession(
  sessionId: string,
  expectedUserId: string,
): Promise<AuthenticatedSession | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          email: true,
          avatarUrl: true,
          status: true,
        },
      },
    },
  });

  if (
    !session ||
    session.revokedAt !== null ||
    session.expiresAt.getTime() < Date.now() ||
    // o portador precisa apontar para o dono real da linha: sem isso, um
    // token antigo continuaria valendo se a linha fosse reaproveitada.
    session.userId !== expectedUserId
  ) {
    return null;
  }

  return {
    sessionId: session.id,
    user: {
      id: session.user.id,
      username: session.user.username,
      displayName: session.user.displayName,
      email: session.user.email,
      avatarUrl: session.user.avatarUrl,
      status: session.user.status as UserStatus,
    },
  };
}
