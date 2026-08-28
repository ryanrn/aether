import { prisma } from "@aether/db";
import {
  limitesDoPlano,
  planoAtende,
  planoEfetivo,
  type PlanLimits,
  type PlanTier,
} from "@aether/shared";

/**
 * O plano de uma pessoa, lido de um lugar so.
 *
 * MORA EM `@aether/access` pelo mesmo motivo que as permissoes de servidor: e
 * uma regra que web e gateway precisam responder IGUAL. Se o app web achasse
 * que alguem e PLUS e o gateway achasse que e FREE, a pessoa pagaria e nao
 * receberia — ou o contrario. Uma copia da regra em cada lado diverge na
 * primeira mudanca.
 *
 * O que este arquivo NAO faz: cobranca. Ele so responde "o que esta conta pode
 * agora". Quem escreve a assinatura e o script de concessao hoje, e o webhook
 * do provedor amanha — os dois na mesma tabela.
 */

export interface PlanoDoUsuario {
  tier: PlanTier;
  limites: PlanLimits;
  /**
   * Quando vence, se vencer. Nulo quando e concedido a mao e sem prazo, ou
   * quando a pessoa esta no gratuito.
   */
  expiraEm: Date | null;
}

/**
 * O plano que vale AGORA para este usuario.
 *
 * Nunca lanca por falta de assinatura: quem nunca pagou nao tem linha, e isso
 * e o caso comum, nao um erro. Sem linha, gratuito.
 */
export async function loadPlan(userId: string): Promise<PlanoDoUsuario> {
  const assinatura = await prisma.subscription.findUnique({
    where: { userId },
    select: { tier: true, expiraEm: true },
  });

  /**
   * O VENCIMENTO E APLICADO AQUI, na leitura.
   *
   * A linha continua no banco com o tier antigo depois de vencer — de
   * proposito. Guardar o historico permite oferecer renovacao e entender
   * cancelamento; e apagar o tier ao vencer perderia essa informacao por nada,
   * ja que a leitura resolve.
   */
  const tier = planoEfetivo(assinatura, new Date());

  return {
    tier,
    limites: limitesDoPlano(tier),
    // So faz sentido anunciar validade do que esta valendo.
    expiraEm: tier === "FREE" ? null : (assinatura?.expiraEm ?? null),
  };
}

/**
 * Esta conta alcanca o plano pedido?
 *
 * Existe para ninguem escrever `plano.tier === "PLUS"` por ai — essa
 * comparacao esquece o PRO, e quem paga mais receberia menos. O erro e facil
 * de cometer e dificil de enxergar numa revisao.
 */
export async function planoAlcanca(
  userId: string,
  minimo: PlanTier,
): Promise<boolean> {
  const { tier } = await loadPlan(userId);
  return planoAtende(tier, minimo);
}

/**
 * Os planos de VARIAS pessoas de uma vez.
 *
 * Uma consulta, e nao uma por pessoa: a lista de membros de um servidor
 * mostraria o selo de cada um, e `loadPlan` num laco faria N consultas para
 * uma tela so. Quem nao tem linha sai como gratuito, sem precisar de entrada
 * no mapa.
 */
export async function loadPlans(
  userIds: string[],
): Promise<Map<string, PlanTier>> {
  const mapa = new Map<string, PlanTier>();
  if (userIds.length === 0) return mapa;

  const linhas = await prisma.subscription.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, tier: true, expiraEm: true },
  });

  const agora = new Date();
  for (const linha of linhas) {
    const tier = planoEfetivo(linha, agora);
    // Gratuito nao entra: quem consulta ja trata a ausencia como gratuito, e
    // guardar a ausencia explicita so aumentaria o mapa sem dizer nada novo.
    if (tier !== "FREE") mapa.set(linha.userId, tier);
  }
  return mapa;
}
