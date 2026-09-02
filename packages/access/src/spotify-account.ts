import { prisma, cifrar, decifrar } from "@aether/db";
import {
  renovarToken,
  SpotifyAutorizacaoInvalida,
  type TokensSpotify,
} from "./spotify";

/**
 * A conta do Spotify ligada a um usuario — guardar, ler um token valido,
 * desligar.
 *
 * Os tokens ficam CIFRADOS (`@aether/db/secret-box`). `tokenDeAcesso` e o
 * unico lugar que renova: quem chama nunca vê refresh token, so recebe um
 * access token bom por pelo menos alguns minutos, ou `null` se a pessoa
 * revogou o acesso no Spotify (ai a linha e apagada).
 */

const MARGEM_MS = 60_000; // renova 1 min antes de expirar

export async function guardarConta(params: {
  userId: string;
  tokens: TokensSpotify;
  spotifyName: string | null;
}): Promise<void> {
  const dados = {
    spotifyName: params.spotifyName,
    accessToken: cifrar(params.tokens.accessToken),
    refreshToken: cifrar(params.tokens.refreshToken),
    expiresAt: new Date(params.tokens.expiresAt),
    scope: params.tokens.scope,
  };
  await prisma.spotifyAccount.upsert({
    where: { userId: params.userId },
    create: { userId: params.userId, ...dados },
    update: dados,
  });
}

export interface EstadoSpotify {
  conectado: true;
  spotifyName: string | null;
  showOnProfile: boolean;
  showAsStatus: boolean;
}

export async function estadoSpotify(
  userId: string,
): Promise<EstadoSpotify | null> {
  const c = await prisma.spotifyAccount.findUnique({
    where: { userId },
    select: { spotifyName: true, showOnProfile: true, showAsStatus: true },
  });
  return c ? { conectado: true, ...c } : null;
}

export async function definirVisibilidade(
  userId: string,
  patch: { showOnProfile?: boolean; showAsStatus?: boolean },
): Promise<void> {
  await prisma.spotifyAccount
    .update({ where: { userId }, data: patch })
    .catch(() => undefined);
}

export async function desconectarSpotify(userId: string): Promise<void> {
  await prisma.spotifyAccount
    .delete({ where: { userId } })
    .catch(() => undefined);
}

/**
 * Um access token valido para este usuario, renovando e persistindo se
 * preciso. `null` quando:
 *  - a pessoa nunca conectou;
 *  - o Spotify recusou o refresh (revogou o acesso) — a linha e apagada.
 */
export async function tokenDeAcesso(userId: string): Promise<string | null> {
  const c = await prisma.spotifyAccount.findUnique({ where: { userId } });
  if (!c) return null;

  if (c.expiresAt.getTime() - MARGEM_MS > Date.now()) {
    try {
      return decifrar(c.accessToken);
    } catch {
      // Segredo ilegivel (AUTH_SECRET trocou?) — trata como desconectado.
      await desconectarSpotify(userId);
      return null;
    }
  }

  // Expirado (ou quase): renova.
  let refresh: string;
  try {
    refresh = decifrar(c.refreshToken);
  } catch {
    await desconectarSpotify(userId);
    return null;
  }

  try {
    const novo = await renovarToken(refresh);
    await prisma.spotifyAccount.update({
      where: { userId },
      data: {
        accessToken: cifrar(novo.accessToken),
        expiresAt: new Date(novo.expiresAt),
        scope: novo.scope,
        ...(novo.refreshToken ? { refreshToken: cifrar(novo.refreshToken) } : {}),
      },
    });
    return novo.accessToken;
  } catch (erro) {
    if (erro instanceof SpotifyAutorizacaoInvalida) {
      await desconectarSpotify(userId);
      return null;
    }
    throw erro; // erro de rede: quem chama tenta de novo depois
  }
}
