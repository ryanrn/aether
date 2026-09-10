import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@aether/db";

/**
 * Token de bot — geracao, hash e RESOLUCAO.
 *
 * Etapa 4 da Developer Platform. Nada aqui e chamado por codigo de produto
 * ainda: a REST v1 (Etapa 6) e o Gateway de bot (Etapa 9) e que vao usar
 * `resolveBotToken` para trocar um `Authorization: Bearer` pela identidade do
 * bot. Mora em `@aether/access` porque os DOIS lados (web e gateway) precisam
 * da MESMA resposta — a regra de "quem e este ator" mora em um lugar so, como
 * `resolveSessionToken`.
 *
 * FORMATO: `aeb_` + 32 bytes aleatorios em base64url. O `aeb_` ("aether bot")
 * identifica o tipo a olho nu (como `ghp_` do GitHub) e serve de filtro barato
 * antes de tocar o banco.
 *
 * ARMAZENAMENTO: o banco guarda SO o `sha256(token)` em `BotToken.tokenHash`
 * (indice unico -> lookup O(1)) e os primeiros caracteres em claro em
 * `BotToken.prefixo`, so para a lista do portal. O token completo existe UMA
 * vez, no retorno de `gerarTokenDeBot`, e nao da para recuperar depois — mesmo
 * desenho de `PlanKey` (`codigoHash` + `prefixo`) e do token de verificacao de
 * e-mail.
 *
 * Nao ha `timingSafeEqual` sobre o hash: a comparacao E o lookup por indice
 * unico, e o sha256 de um palpite errado nao casa com linha nenhuma. Mesma
 * escolha de `verificacao.ts` / `password-reset.ts` / `planos.ts`.
 */

/** Prefixo do token. Tambem e o inicio do `prefixo` guardado em claro. */
export const PREFIXO_TOKEN_BOT = "aeb_";

/** Quantos caracteres do token vao, em claro, para `BotToken.prefixo`. */
const TAMANHO_DO_PREFIXO = 12;

/**
 * Gera um token novo. Devolve o token EM CLARO (mostrar uma vez) e as duas
 * partes que vao para o banco. Quem persiste e o servico do portal (Etapa 8).
 */
export function gerarTokenDeBot(): {
  token: string;
  tokenHash: string;
  prefixo: string;
} {
  const token = PREFIXO_TOKEN_BOT + randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashDoTokenDeBot(token),
    prefixo: token.slice(0, TAMANHO_DO_PREFIXO),
  };
}

/** sha256 hex do token — o que vai (e e procurado) em `BotToken.tokenHash`. */
export function hashDoTokenDeBot(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A identidade que um token de bot resolve. */
export interface BotIdentity {
  /** id da `Application` dona do token */
  applicationId: string;
  /** id da linha `User` (`kind = BOT`) — o ATOR nas checagens de permissao */
  botUserId: string;
}

/**
 * Troca um token pela identidade do bot, ou `null` para QUALQUER recusa:
 *
 *  - nao e string / nao comeca com `aeb_` -> `null` SEM tocar o banco;
 *  - token desconhecido -> `null`;
 *  - token revogado (`BotToken.revokedAt`) -> `null`;
 *  - aplicacao bloqueada pela equipe (`Application.blockedAt`) -> `null`;
 *  - bot ainda nao habilitado (`Application.botUserId` nulo) -> `null`.
 *
 * Recusa sem detalhe de proposito — quem chama nao precisa saber qual porta
 * fechou. Nao substitui checagem de permissao: `resolveBotToken` diz QUEM e o
 * ator; `Installation` + `loadMemberAccess` dizem ONDE ele pode agir.
 *
 * `lastUsedAt` e atualizado em best-effort (nao aguardado, erro engolido): e
 * telemetria de uso anomalo, nao autorizacao. Numa funcao serverless a
 * atualizacao pode ser descartada apos a resposta — aceitavel.
 */
export async function resolveBotToken(
  raw: string | null | undefined,
): Promise<BotIdentity | null> {
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  if (!token.startsWith(PREFIXO_TOKEN_BOT)) return null;

  const tokenHash = hashDoTokenDeBot(token);
  const row = await prisma.botToken.findUnique({
    where: { tokenHash },
    select: {
      applicationId: true,
      revokedAt: true,
      application: { select: { blockedAt: true, botUserId: true } },
    },
  });

  if (!row || row.revokedAt !== null) return null;
  if (row.application.blockedAt !== null) return null;
  if (row.application.botUserId === null) return null;

  void prisma.botToken
    .update({ where: { tokenHash }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return {
    applicationId: row.applicationId,
    botUserId: row.application.botUserId,
  };
}
