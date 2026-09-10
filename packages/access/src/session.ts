import { prisma } from "@aether/db";
import {
  SELECT_USUARIO_PUBLICO,
  toPublicUser,
  type PublicUser,
} from "@aether/shared";
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
  /**
   * `email` e `allowServerDms` ficam FORA de `PublicUser` de proposito: o
   * primeiro nunca desce para o navegador de outra pessoa, e o segundo e uma
   * preferencia de quem esta logado — nao um atributo publico de perfil.
   */
  user: PublicUser & {
    email: string;
    /**
     * Administracao global. Fica FORA de `PublicUser` de proposito: quem e da
     * equipe nao e atributo publico de perfil, e nao tem por que aparecer no
     * navegador de outra pessoa.
     */
    equipe: boolean;
    allowServerDms: boolean;
    allowServerFriendRequests: boolean;
    /** null = e-mail nao confirmado. A parede em /app olha isto. */
    emailVerificadoEm: Date | null;
    /** null = nao silenciado globalmente. `silenciadoAte` no futuro = temporario. */
    silenciadoEm: Date | null;
    silenciadoAte: Date | null;
    /** aceite dos Termos: nulo ou `termosVersao` antiga dispara o modal em /app */
    aceitouTermosEm: Date | null;
    termosVersao: string | null;
  };
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
          ...SELECT_USUARIO_PUBLICO,
          email: true,
          equipe: true,
          emailVerificadoEm: true,
          silenciadoEm: true,
          silenciadoAte: true,
          aceitouTermosEm: true,
          termosVersao: true,
          // Preferencia de contato: quem pode abrir conversa comigo sem ser
          // amigo. Vem na sessao para a tela de configuracoes nao precisar de
          // uma ida ao banco so para desenhar uma chave.
          allowServerDms: true,
          allowServerFriendRequests: true,
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
    session.userId !== expectedUserId ||
    // Identidade sem e-mail = `kind` BOT/WEBHOOK. Elas nunca tem sessao (nao
    // logam), entao uma linha `Session` apontando para uma delas so pode ser
    // lixo. Recusar aqui tambem estreita `email` para `string` abaixo.
    session.user.email === null
  ) {
    return null;
  }

  return {
    sessionId: session.id,
    user: {
      ...toPublicUser(session.user),
      email: session.user.email,
      equipe: session.user.equipe,
      allowServerDms: session.user.allowServerDms,
      allowServerFriendRequests: session.user.allowServerFriendRequests,
      emailVerificadoEm: session.user.emailVerificadoEm,
      silenciadoEm: session.user.silenciadoEm,
      silenciadoAte: session.user.silenciadoAte,
      aceitouTermosEm: session.user.aceitouTermosEm,
      termosVersao: session.user.termosVersao,
    },
  };
}
