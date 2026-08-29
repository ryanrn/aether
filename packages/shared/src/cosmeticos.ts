import { planoAtende, type PlanTier } from "./plans";

/**
 * Cosmeticos de perfil — hoje molduras de avatar; amanha badges e efeitos.
 *
 * O CATALOGO MORA EM CODIGO, e nao no banco. Uma moldura e uma definicao
 * visual, e linha de banco guardaria uma string de CSS — ai o visual do app
 * virava dado editavel, com tudo que isso traz (injecao, migracao, revisao).
 * O banco guarda apenas QUAL a pessoa escolheu.
 *
 * E o mesmo desenho de `plans.ts`: a escada e codigo, a assinatura e banco.
 *
 * AQUI FICA SO O QUE O SERVIDOR PRECISA SABER: que a moldura existe e qual
 * plano a libera. O visual (cor, gradiente, espessura) mora em
 * `apps/web/src/components/ui/molduras.ts`, porque o Tailwind so gera classe
 * que ele encontra escrita nos arquivos que varre — e ele nao varre este
 * pacote. Classe declarada aqui simplesmente nao existiria no CSS final.
 *
 * PARA ADICIONAR UMA MOLDURA: uma entrada aqui e uma no mapa de estilo. A
 * regra de plano ja e generica e nao muda.
 */

export interface Moldura {
  id: string;
  /** o nome que a pessoa le na tela */
  nome: string;
  /** plano MINIMO que libera. `FREE` = todo mundo tem. */
  tier: PlanTier;
}

/**
 * As molduras, da mais simples para a mais chamativa.
 *
 * A ESCADA DE COR SEGUE A DO SELO, de proposito: arroxeado no Olimpo, dourado
 * no Olimpo Pro. Quem olha entende a hierarquia sem ler o nome — foi a
 * promessa feita no comentario do `SeloPlano` quando ele nasceu.
 *
 * Ha UMA moldura gratuita de proposito. Quem nao paga precisa poder mexer no
 * proprio perfil e ver o recurso existir; catalogo inteiro trancado nao vende,
 * so avisa que voce nao pertence.
 */
export const MOLDURAS: readonly Moldura[] = [
  { id: "bronze", nome: "Bronze", tier: "FREE" },
  { id: "eter", nome: "Eter", tier: "PLUS" },
  { id: "aurora", nome: "Aurora", tier: "PLUS" },
  { id: "louro", nome: "Louro", tier: "PRO" },
  { id: "olimpo", nome: "Olimpo", tier: "PRO" },
] as const;

const POR_ID = new Map(MOLDURAS.map((m) => [m.id, m]));

export function molduraPorId(id: string | null | undefined): Moldura | null {
  if (!id) return null;
  return POR_ID.get(id) ?? null;
}

/**
 * A moldura que de fato vale AGORA, dado o plano de quem a escolheu.
 *
 * Resolvida na LEITURA, como `planoEfetivo`. Quem deixa de pagar para de
 * exibir a moldura paga, mas a ESCOLHA continua guardada: reativando, ela volta
 * sozinha, sem a pessoa precisar lembrar qual era.
 *
 * A alternativa — seguir exibindo — abriria assinar um mes, escolher a moldura
 * e cancelar. Cosmetico que nao expira nao e cosmetico de assinatura: e compra
 * unica com o nome errado.
 *
 * Id desconhecido devolve `null` em vez de lancar: uma moldura retirada do
 * catalogo nao pode quebrar a tela de quem a tinha escolhido.
 */
export function molduraEfetiva(
  id: string | null | undefined,
  plano: PlanTier,
): Moldura | null {
  const moldura = molduraPorId(id);
  if (!moldura) return null;
  return planoAtende(plano, moldura.tier) ? moldura : null;
}

/** As molduras que este plano pode escolher — o que a tela mostra destravado. */
export function moldurasDoPlano(plano: PlanTier): Moldura[] {
  return MOLDURAS.filter((m) => planoAtende(plano, m.tier));
}

/**
 * Avatar animado (GIF) e exclusivo do plano de cima.
 *
 * Funcao, e nao comparacao solta espalhada: quando entrar "banner animado" ou
 * "efeito de avatar", a regra de quem pode enviar movimento fica num lugar so.
 */
export function podeAvatarAnimado(plano: PlanTier): boolean {
  return planoAtende(plano, "PRO");
}
