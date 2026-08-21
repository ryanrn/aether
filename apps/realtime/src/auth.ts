import { resolveSessionToken, SESSION_COOKIE } from "@aether/access";
import type { SocketData } from "@aether/shared";

/**
 * Autenticacao do handshake WebSocket.
 *
 * O gateway NAO tem login proprio. Ele le o mesmo cookie httpOnly que o app
 * web grava e valida com a mesma funcao (@aether/access): assinatura do JWT,
 * linha `Session` no banco, revogacao e expiracao. Consequencia pratica: um
 * logout no app impede nova conexao aqui, e nao existe um segundo caminho de
 * autenticacao para manter em dia.
 *
 * Por que cookie e nao token no `auth` do Socket.IO: o cookie e httpOnly, ou
 * seja, JavaScript da pagina nao consegue ler o token para mandar no payload.
 * Isso e proposital — mantem o token fora do alcance de XSS.
 */

/** Parser minimo de Cookie: evita uma dependencia para ler um unico valor. */
export function readCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const raw = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/**
 * Retorna os dados da conexao, ou `null` para recusar o handshake.
 * Recusar sem detalhe e intencional: o cliente nao precisa saber se o token
 * era invalido, expirado ou revogado.
 */
export async function authenticateHandshake(
  cookieHeader: string | undefined,
): Promise<SocketData | null> {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return null;

  const session = await resolveSessionToken(token);
  if (!session) return null;

  const { email: _email, ...user } = session.user;
  return { userId: user.id, sessionId: session.sessionId, user };
}
