import {
  atualizarTokens,
  definirVisibilidadeDaConexao,
  desconectar,
  guardarConexao,
  lerConexao,
  segredos,
} from "./conexoes";
import {
  renovarToken,
  SpotifyAutorizacaoInvalida,
  type TokensSpotify,
} from "./spotify";

/**
 * A conta do Spotify ligada a um usuario — guardar, ler um token valido,
 * desligar.
 *
 * FACHADA sobre `conexoes.ts`, que e generica. O que sobrou aqui e o que so o
 * Spotify tem: renovar pelo endpoint deles e saber que "autorizacao invalida"
 * quer dizer que a pessoa revogou o acesso, e nao que a rede caiu.
 *
 * As assinaturas sao as MESMAS de quando isto falava direto com uma tabela
 * `SpotifyAccount` — os quatro lugares que consomem (poller do gateway,
 * callback do OAuth, rota de estado, actions) nao mudaram nenhuma linha.
 *
 * `tokenDeAcesso` continua sendo o unico lugar que renova: quem chama nunca ve
 * refresh token, so recebe um access token bom por pelo menos alguns minutos,
 * ou `null` se a pessoa revogou o acesso no Spotify (ai a linha e apagada).
 */

const MARGEM_MS = 60_000; // renova 1 min antes de expirar

export async function guardarConta(params: {
  userId: string;
  tokens: TokensSpotify;
  spotifyName: string | null;
  /**
   * Id da pessoa NO Spotify. Opcional porque as contas ligadas antes da
   * tabela generica nao o tem — a antiga so guardava o nome. Preenche na
   * proxima reconexao.
   */
  spotifyId?: string | null;
}): Promise<void> {
  await guardarConexao({
    userId: params.userId,
    provider: "SPOTIFY",
    externalId: params.spotifyId ?? null,
    displayName: params.spotifyName,
    accessToken: params.tokens.accessToken,
    refreshToken: params.tokens.refreshToken,
    expiresAt: new Date(params.tokens.expiresAt),
    scope: params.tokens.scope,
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
  const c = await lerConexao(userId, "SPOTIFY");
  return c
    ? {
        conectado: true,
        spotifyName: c.displayName,
        showOnProfile: c.showOnProfile,
        showAsStatus: c.showAsStatus,
      }
    : null;
}

export async function definirVisibilidade(
  userId: string,
  patch: { showOnProfile?: boolean; showAsStatus?: boolean },
): Promise<void> {
  await definirVisibilidadeDaConexao(userId, "SPOTIFY", patch);
}

export async function desconectarSpotify(userId: string): Promise<void> {
  await desconectar(userId, "SPOTIFY");
}

/**
 * Um access token valido para este usuario, renovando e persistindo se
 * preciso. `null` quando:
 *  - a pessoa nunca conectou;
 *  - o segredo esta ilegivel (o `AUTH_SECRET` mudou) — trata como desconectado;
 *  - o Spotify recusou o refresh (revogou o acesso) — a linha e apagada.
 */
export async function tokenDeAcesso(userId: string): Promise<string | null> {
  const s = await segredos(userId, "SPOTIFY");
  // `null` aqui e "nunca conectou" ou "segredo ilegivel" — no segundo caso a
  // propria `segredos` ja apagou a linha morta. Nada a fazer nos dois.
  if (!s) return null;

  if (s.expiresAt && s.expiresAt.getTime() - MARGEM_MS > Date.now()) {
    return s.accessToken;
  }

  // Expirado (ou quase): renova. Sem refresh token nao ha o que renovar.
  if (!s.refreshToken) {
    await desconectar(userId, "SPOTIFY");
    return null;
  }

  try {
    const novo = await renovarToken(s.refreshToken);
    await atualizarTokens(userId, "SPOTIFY", {
      accessToken: novo.accessToken,
      refreshToken: novo.refreshToken ?? null,
      expiresAt: new Date(novo.expiresAt),
      scope: novo.scope,
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
