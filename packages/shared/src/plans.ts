/**
 * Planos e o que cada um da.
 *
 * ESTA TABELA E A UNICA FONTE. Web, gateway e `@aether/access` leem daqui —
 * uma segunda copia dos numeros divergiria na primeira vez que alguem mexesse
 * em um lado so, e divergencia aqui nao e defeito de tela: e alguem pagando
 * por 1080p e recebendo 720, ou o contrario.
 *
 * PLANO NAO E PERMISSAO DE SERVIDOR, e por isso nao mora em `permissions.ts`.
 * Os bits sao por servidor e concedidos por CARGO — o dono decide quem
 * modera. O plano e da PESSOA e vale em todo lugar; se virasse bit, um dono de
 * servidor poderia dar "premium" para quem quisesse.
 */

export type PlanTier = "FREE" | "PLUS" | "PRO";

/** A ordem importa: compara-se plano por posicao, nunca por nome. */
export const PLAN_ORDER: PlanTier[] = ["FREE", "PLUS", "PRO"];

export interface PlanLimits {
  tier: PlanTier;
  /**
   * O nome que aparece na tela.
   *
   * SEPARADO DO `tier` de proposito, e isso ja provou o valor: o nome passou
   * por "AETHER+", "VIP" e um terceiro nome antes de virar Olimpo, e nenhuma
   * trocas encostou no banco. O enum continua FREE/PLUS/PRO — nome de marca
   * muda, identificador de dado nao.
   *
   * Olimpo veio da mesma familia do nome do app: Aether e um deus primordial
   * grego, e o Olimpo e onde ficam os deuses. Cabe no selo, que e um chip
   * pequeno em maiusculas — nome longo nao entra ali.
   */
  rotulo: string;

  /* ---- compartilhamento de tela ---- */
  larguraMax: number;
  alturaMax: number;
  quadrosMax: number;
  /** teto de bitrate, em bits por segundo */
  bitrateMax: number;
  /** pode levar o som do sistema junto */
  somDaTela: boolean;
  /** quantas telas a MESMA pessoa pode transmitir ao mesmo tempo */
  telasSimultaneas: number;

  /* ---- envio de arquivo ---- */
  uploadMaxBytes: number;
}

const MB = 1024 * 1024;

export const PLANS: Record<PlanTier, PlanLimits> = {
  FREE: {
    tier: "FREE",
    rotulo: "Aether",
    larguraMax: 1280,
    alturaMax: 720,
    quadrosMax: 30,
    bitrateMax: 2_500_000,
    somDaTela: true,
    telasSimultaneas: 1,
    uploadMaxBytes: 25 * MB,
  },
  PLUS: {
    tier: "PLUS",
    rotulo: "Olimpo",
    larguraMax: 1920,
    alturaMax: 1080,
    quadrosMax: 60,
    bitrateMax: 6_000_000,
    somDaTela: true,
    telasSimultaneas: 2,
    uploadMaxBytes: 250 * MB,
  },
  PRO: {
    tier: "PRO",
    rotulo: "Olimpo Pro",
    larguraMax: 2560,
    alturaMax: 1440,
    quadrosMax: 60,
    bitrateMax: 10_000_000,
    somDaTela: true,
    telasSimultaneas: 3,
    uploadMaxBytes: 1024 * MB,
  },
};

/** Os limites de um plano. Valor desconhecido cai no gratuito. */
export function limitesDoPlano(tier: PlanTier | null | undefined): PlanLimits {
  if (!tier) return PLANS.FREE;
  return PLANS[tier] ?? PLANS.FREE;
}

/**
 * `a` da pelo menos tudo o que `b` da?
 *
 * Comparacao por POSICAO na escada, e nao por igualdade: perguntar
 * `tier === "PLUS"` esquece o PRO, e quem paga mais receberia menos. Este erro
 * e facil de escrever e dificil de ver, entao existe uma funcao para ele.
 */
export function planoAtende(a: PlanTier, b: PlanTier): boolean {
  return PLAN_ORDER.indexOf(a) >= PLAN_ORDER.indexOf(b);
}

/**
 * O plano que vale AGORA, dado o que esta guardado.
 *
 * O VENCIMENTO E DECIDIDO NA LEITURA, e nao por um trabalho agendado que vira
 * linhas no banco. Um job que falha, atrasa ou nunca sobe deixaria a pessoa
 * premium para sempre — e ninguem descobre, porque o defeito e silencioso e
 * favorece quem tem. Lendo, a conta expira sozinha no segundo exato, mesmo com
 * o resto do sistema parado.
 *
 * `expiraEm` nulo significa SEM VALIDADE — usado para conta concedida a mao
 * (equipe, teste, cortesia), que nao deveria virar abobora sozinha.
 */
export function planoEfetivo(
  assinatura:
    | { tier: PlanTier; expiraEm: Date | string | null | undefined }
    | null
    | undefined,
  agora: Date = new Date(),
): PlanTier {
  if (!assinatura) return "FREE";
  if (!assinatura.expiraEm) return assinatura.tier;

  const fim =
    assinatura.expiraEm instanceof Date
      ? assinatura.expiraEm
      : new Date(assinatura.expiraEm);
  if (Number.isNaN(fim.getTime())) return "FREE";

  return fim.getTime() > agora.getTime() ? assinatura.tier : "FREE";
}

/**
 * Uma tela publicada nesta altura passa do teto do plano?
 *
 * MORA AQUI, e nao dentro do gateway, por duas razoes. A regra precisa ser a
 * mesma que a interface usa para trancar o perfil — se as duas discordarem, a
 * pessoa escolhe algo que a tela oferece e o servidor derruba, que e a pior
 * combinacao possivel. E porque assim ela e testavel sem SFU, sem sala e sem
 * ninguem transmitindo.
 *
 * A TOLERANCIA de 10% existe porque o codificador nem sempre entrega o que foi
 * pedido: 1080p pode sair 1082 conforme o recorte da janela, e a altura varia
 * com o formato da tela capturada. Barrar por dois pixels puniria quem esta
 * dentro do plano — e o que se quer impedir e 1440p com plano de 720, nao
 * arredondamento.
 *
 * Altura ZERO nao e violacao: e o SFU ainda nao sabendo as dimensoes da faixa.
 * Tratar como excesso silenciaria toda transmissao no instante em que comeca.
 */
export const TOLERANCIA_DE_ALTURA = 1.1;

export function alturaExcedeOPlano(
  alturaPublicada: number,
  alturaMax: number,
): boolean {
  if (!Number.isFinite(alturaPublicada) || alturaPublicada <= 0) return false;
  return alturaPublicada > alturaMax * TOLERANCIA_DE_ALTURA;
}
