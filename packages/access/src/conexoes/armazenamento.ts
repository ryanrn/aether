import { prisma, cifrar, decifrar } from "@aether/db";
import type { ConnectionProvider } from "@aether/db";

/**
 * Contas de servicos externos ligadas a uma conta do Aether.
 *
 * Camada GENERICA: guardar, ler, apagar, e a visibilidade de cada conexao.
 * Nada aqui sabe o que e Spotify — quem sabe e `spotify-account.ts`, que usa
 * estas funcoes e cuida do que so o Spotify tem (renovar token pela API
 * deles, tratar "a pessoa revogou o acesso").
 *
 * A separacao existe porque os provedores NAO tem o mesmo formato:
 *  - Spotify e Twitch: OAuth 2.0, com token e refresh;
 *  - Steam: OpenID 2.0 — autentica e NAO devolve token de usuario;
 *  - Riot: so identidade, sem API publica de presenca.
 *
 * Um contrato que assumisse "todo provedor tem token e atividade" quebraria
 * em dois dos quatro. Por isso os campos de token sao opcionais aqui.
 *
 * OS TOKENS SO SAEM DAQUI DECIFRADOS PELA `segredos()`. Guardar e cifrar e
 * responsabilidade destas funcoes: quem chama nunca monta o `cifrar()` na
 * mao, senao a primeira distracao grava um refresh token em claro.
 */

export type { ConnectionProvider };

/** O que a tela precisa saber sobre uma conexao. Nunca inclui token. */
export interface ConexaoVisivel {
  provider: ConnectionProvider;
  displayName: string | null;
  showOnProfile: boolean;
  showAsStatus: boolean;
}

/**
 * O que um PROVEDOR precisa da conexao guardada — tokens ja decifrados.
 *
 * `accessToken` e opcional porque o Steam nao tem nenhum: ele autentica por
 * OpenID 2.0 e a atividade e lida com a chave do APLICATIVO mais o
 * `externalId`. Exigir token aqui deixaria o Steam de fora do modelo.
 */
export interface SegredosDaConexao {
  /** o id da pessoa no servico — e o que o Steam usa no lugar do token */
  externalId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
}

export interface DadosParaGuardar {
  userId: string;
  provider: ConnectionProvider;
  /** id da pessoa no servico; `null` quando o provedor nao expoe */
  externalId?: string | null;
  displayName?: string | null;
  /** `null` em provedor sem token de usuario (Steam) */
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scope?: string | null;
}

/**
 * Liga (ou religa) uma conta.
 *
 * `upsert` pelo par `[userId, provider]`: reconectar o mesmo servico atualiza
 * a linha em vez de criar uma segunda. As chaves de visibilidade NAO entram
 * no `update` — quem ja tinha desligado "exibir no perfil" nao quer isso de
 * volta so porque reautorizou.
 */
export async function guardarConexao(dados: DadosParaGuardar): Promise<void> {
  const comum = {
    externalId: dados.externalId ?? null,
    displayName: dados.displayName ?? null,
    accessToken: dados.accessToken ? cifrar(dados.accessToken) : null,
    refreshToken: dados.refreshToken ? cifrar(dados.refreshToken) : null,
    expiresAt: dados.expiresAt ?? null,
    scope: dados.scope ?? null,
  };
  await prisma.connection.upsert({
    where: {
      userId_provider: { userId: dados.userId, provider: dados.provider },
    },
    create: { userId: dados.userId, provider: dados.provider, ...comum },
    update: comum,
  });
}

export async function lerConexao(
  userId: string,
  provider: ConnectionProvider,
): Promise<ConexaoVisivel | null> {
  const c = await prisma.connection.findUnique({
    where: { userId_provider: { userId, provider } },
    select: {
      provider: true,
      displayName: true,
      showOnProfile: true,
      showAsStatus: true,
    },
  });
  return c ?? null;
}

/** Todas as conexoes de alguem, para a aba "Apps conectados". */
export async function listarConexoes(
  userId: string,
): Promise<ConexaoVisivel[]> {
  return prisma.connection.findMany({
    where: { userId },
    select: {
      provider: true,
      displayName: true,
      showOnProfile: true,
      showAsStatus: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function definirVisibilidadeDaConexao(
  userId: string,
  provider: ConnectionProvider,
  patch: { showOnProfile?: boolean; showAsStatus?: boolean },
): Promise<void> {
  // `catch` silencioso: desligar o que ja nao existe nao e erro de ninguem.
  await prisma.connection
    .update({ where: { userId_provider: { userId, provider } }, data: patch })
    .catch(() => undefined);
}

export async function desconectar(
  userId: string,
  provider: ConnectionProvider,
): Promise<void> {
  await prisma.connection
    .delete({ where: { userId_provider: { userId, provider } } })
    .catch(() => undefined);
}

/**
 * Os segredos decifrados, ou `null` quando NAO HA CONEXAO.
 *
 * Tambem `null` quando o segredo esta ILEGIVEL — o caso real e o
 * `AUTH_SECRET` ter mudado, e ai nenhuma linha antiga abre. Devolver `null`
 * faz quem chama tratar como "desconectado" e mandar reconectar, em vez de
 * estourar uma excecao de decifra num laco de fundo.
 *
 * Conexao SEM token nao e ausencia de conexao: o Steam existe assim. Por isso
 * a checagem e "existe a linha?", e nao "existe accessToken?".
 */
export async function segredos(
  userId: string,
  provider: ConnectionProvider,
): Promise<SegredosDaConexao | null> {
  const c = await prisma.connection.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (!c) return null;
  try {
    return {
      externalId: c.externalId,
      accessToken: c.accessToken ? decifrar(c.accessToken) : null,
      refreshToken: c.refreshToken ? decifrar(c.refreshToken) : null,
      expiresAt: c.expiresAt,
      scope: c.scope,
    };
  } catch {
    /**
     * Segredo ilegivel — na pratica, o `AUTH_SECRET` mudou e nenhuma linha
     * antiga abre mais. A linha esta morta: guardada, mas inutil. Apagar
     * AQUI, e nao em quem chama, porque isto vale para qualquer provedor e
     * porque deixar a linha faria a tela dizer "conectado" para uma conexao
     * que nunca mais vai funcionar.
     */
    await desconectar(userId, provider);
    return null;
  }
}

/** Troca os tokens depois de uma renovacao. Nao mexe em visibilidade. */
export async function atualizarTokens(
  userId: string,
  provider: ConnectionProvider,
  novos: {
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: Date | null;
    scope?: string | null;
  },
): Promise<void> {
  await prisma.connection.update({
    where: { userId_provider: { userId, provider } },
    data: {
      accessToken: cifrar(novos.accessToken),
      ...(novos.refreshToken
        ? { refreshToken: cifrar(novos.refreshToken) }
        : {}),
      ...(novos.expiresAt ? { expiresAt: novos.expiresAt } : {}),
      ...(novos.scope ? { scope: novos.scope } : {}),
    },
  });
}
