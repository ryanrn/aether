import type { ConnectionProvider } from "@aether/db";
import type { MusicActivity } from "@aether/shared";

/**
 * O contrato que um servico externo precisa cumprir para virar uma conexao.
 *
 * POR QUE ELE TEM TANTO CAMPO OPCIONAL: os provedores nao tem o mesmo
 * formato, e um contrato que fingisse que tem quebraria em dois dos quatro.
 *
 *   Spotify   OAuth 2.0 · token de usuario · atividade (o que toca agora)
 *   Twitch    OAuth 2.0 · token de usuario · atividade (esta ao vivo)
 *   Steam     OpenID 2.0 · SEM token de usuario · atividade pela chave do app
 *   Riot      RSO · token de usuario · SEM atividade (nao ha API de presenca)
 *
 * Por isso `renovar` e `lerAtividade` sao opcionais: a AUSENCIA deles e a
 * informacao. Um provedor sem `lerAtividade` e um cracha — mostra o nome no
 * perfil e mais nada, que e exatamente o caso da Riot.
 */

/**
 * A pessoa revogou o acesso, ou o token morreu de vez.
 *
 * Distinta de erro de rede DE PROPOSITO: esta manda apagar a conexao, aquela
 * manda tentar de novo depois. Trocar as duas ou apaga conexao boa por causa
 * de um timeout, ou mantem para sempre uma conexao que nunca mais funciona.
 */
export class AutorizacaoInvalida extends Error {
  constructor(readonly provider: ConnectionProvider) {
    super(`Autorizacao invalida em ${provider}.`);
    this.name = "AutorizacaoInvalida";
  }
}

/** Faltam segredos no ambiente. A tela mostra "indisponivel", nao um erro. */
export class ProvedorNaoConfigurado extends Error {
  constructor(readonly provider: ConnectionProvider) {
    super(`${provider} nao esta configurado neste ambiente.`);
    this.name = "ProvedorNaoConfigurado";
  }
}

/**
 * O que a pessoa esta fazendo no servico, no formato da presenca.
 *
 * Uniao discriminada, e nao um objeto solto: "ouvindo musica" e "jogando" tem
 * campos diferentes, e achatar os dois num tipo com tudo opcional empurraria
 * a checagem para cada lugar que consome. Hoje so `musica` existe — as outras
 * entram quando o provedor que as produz entrar, nao antes.
 */
export type AtividadeExterna = { tipo: "musica"; musica: MusicActivity };

/** O que sai de um login bem-sucedido, pronto para ser guardado. */
export interface ResultadoDoLogin {
  /** id da pessoa NO SERVICO; `null` quando o provedor nao expoe */
  externalId: string | null;
  displayName: string | null;
  /** `null` em provedor sem token de usuario (Steam) */
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
}

export interface TokensRenovados {
  accessToken: string;
  /** alguns provedores devolvem um refresh novo; outros mantem o antigo */
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
}

/**
 * O que `lerAtividade` recebe.
 *
 * Traz `accessToken` E `externalId` porque os provedores leem de jeitos
 * diferentes: o Spotify pergunta "o que ESTE token esta ouvindo"; o Steam
 * pergunta "o que ESTE steamId esta jogando", usando a chave do aplicativo e
 * token nenhum.
 */
export interface ContextoDeAtividade {
  userId: string;
  externalId: string | null;
  accessToken: string | null;
}

export interface Provedor {
  readonly id: ConnectionProvider;
  /** nome como a pessoa conhece: "Spotify", "Steam" */
  readonly nome: string;
  /** Ha segredos no ambiente para este provedor funcionar? */
  configurado(): boolean;
  /**
   * Para onde mandar o navegador. O `state` ja vem assinado e amarrado ao par
   * (usuario, provedor) — o provedor so o repassa.
   */
  urlDeLogin(redirectUri: string, state: string): string;
  /**
   * Conclui o login com o que voltou na URL de callback.
   *
   * Recebe os parametros CRUS: o Spotify manda `code`, o Steam manda uma dúzia
   * de campos `openid.*`. Quem sabe ler cada um e o proprio provedor.
   */
  concluirLogin(
    parametros: URLSearchParams,
    redirectUri: string,
  ): Promise<ResultadoDoLogin>;
  /** Ausente = provedor sem token de usuario (Steam). */
  renovar?(refreshToken: string): Promise<TokensRenovados>;
  /** Ausente = a conexao e so um cracha (Riot). */
  lerAtividade?(ctx: ContextoDeAtividade): Promise<AtividadeExterna | null>;
}
