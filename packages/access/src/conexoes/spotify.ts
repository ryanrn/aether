import {
  buscarPerfil,
  buscarTocandoAgora,
  renovarToken,
  spotifyConfigurado,
  SpotifyAutorizacaoInvalida,
  trocarCodigo,
  urlDeAutorizacao,
} from "../spotify";
import {
  AutorizacaoInvalida,
  type AtividadeExterna,
  type ContextoDeAtividade,
  type Provedor,
  type ResultadoDoLogin,
  type TokensRenovados,
} from "./tipos";

/**
 * O Spotify como PROVEDOR — o primeiro a cumprir o contrato.
 *
 * Nao reimplementa nada: `../spotify.ts` continua sendo quem fala com a API
 * deles. Este arquivo so traduz aquilo para o formato que o registro entende,
 * e e propositalmente magro — se um adaptador precisar ser grande, o contrato
 * esta errado.
 *
 * Serviu de prova do contrato: foi escrito DEPOIS do `tipos.ts` e sem mudar
 * uma linha dele. Twitch deve caber igual; Steam vai deixar `renovar` de fora
 * (OpenID nao da token de usuario) e Riot vai deixar `lerAtividade` de fora
 * (nao ha API publica de presenca).
 */

/**
 * Traduz o erro do Spotify para o erro do contrato.
 *
 * O tipo do erro e o que decide entre APAGAR a conexao e TENTAR DE NOVO
 * depois. Deixar o erro especifico vazar para o registro faria cada provedor
 * novo obrigar o registro a conhece-lo.
 */
function traduzir(erro: unknown): never {
  if (erro instanceof SpotifyAutorizacaoInvalida) {
    throw new AutorizacaoInvalida("SPOTIFY");
  }
  throw erro;
}

export const spotifyProvedor: Provedor = {
  id: "SPOTIFY",
  nome: "Spotify",

  configurado: spotifyConfigurado,

  urlDeLogin(redirectUri, state) {
    return urlDeAutorizacao(redirectUri, state);
  },

  async concluirLogin(parametros, redirectUri): Promise<ResultadoDoLogin> {
    const code = parametros.get("code");
    if (!code) throw new Error("Spotify nao devolveu `code`.");

    const tokens = await trocarCodigo(code, redirectUri).catch(traduzir);

    /**
     * O perfil e MELHOR-ESFORCO: sem ele a conexao ainda funciona, so fica
     * sem nome na tela. Derrubar um login que ja deu certo porque uma
     * chamada secundaria falhou seria trocar o certo pelo duvidoso.
     */
    const perfil = await buscarPerfil(tokens.accessToken).catch(() => ({
      displayName: null,
      id: null,
    }));

    return {
      externalId: perfil.id,
      displayName: perfil.displayName,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(tokens.expiresAt),
      scope: tokens.scope,
    };
  },

  async renovar(refreshToken): Promise<TokensRenovados> {
    const novo = await renovarToken(refreshToken).catch(traduzir);
    return {
      accessToken: novo.accessToken,
      refreshToken: novo.refreshToken ?? null,
      expiresAt: new Date(novo.expiresAt),
      scope: novo.scope,
    };
  },

  async lerAtividade(ctx: ContextoDeAtividade): Promise<AtividadeExterna | null> {
    // Sem token nao ha o que perguntar — o registro so chama com token valido,
    // mas a checagem impede uma chamada sem `Authorization` se isso mudar.
    if (!ctx.accessToken) return null;
    const musica = await buscarTocandoAgora(ctx.accessToken).catch(traduzir);
    return musica ? { tipo: "musica", musica } : null;
  },
};
