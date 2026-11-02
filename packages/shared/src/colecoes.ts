/**
 * COLECOES DA LOJA — a regra do periodo de venda, num lugar so.
 *
 * O servidor usa para decidir o que aparece, o que se compra, o que se
 * resgata e o que se equipa; a tela usa so para escrever "sai em 3 dias".
 * Duas copias desta regra divergiriam, e divergir aqui e vender item fora do
 * prazo.
 */

/** O que a regra precisa de uma colecao — linha crua do banco. */
export interface ColecaoRow {
  ativa: boolean;
  inicioEm: Date | null;
  fimEm: Date | null;
}

/**
 * A colecao esta NO AR: ativa, ja comecou e ainda nao acabou. `fimEm` e
 * exclusivo — no instante do fim ela ja saiu.
 */
export function colecaoNoAr(c: ColecaoRow, agora: Date): boolean {
  if (!c.ativa) return false;
  if (c.inicioEm && agora < c.inicioEm) return false;
  if (c.fimEm && agora >= c.fimEm) return false;
  return true;
}

/** Item sem colecao esta sempre disponivel; com colecao, so com ela no ar. */
export function itemNoAr(
  colecao: ColecaoRow | null | undefined,
  agora: Date,
): boolean {
  return !colecao || colecaoNoAr(colecao, agora);
}

/**
 * Item GRATIS numa colecao COM PRAZO precisa ser resgatado: e o resgate que
 * grava a posse, e e a posse que o mantem seu depois do fim. Sem isso o item
 * gratis "por tempo limitado" sumiria de quem o usa no dia seguinte.
 */
export function exigeResgate(
  precoMoedas: number | null,
  colecao: ColecaoRow | null | undefined,
): boolean {
  return precoMoedas == null && colecao?.fimEm != null;
}

/**
 * A pessoa pode EQUIPAR o item agora (o plano ja foi checado a parte)?
 *
 *  - quem possui (comprou, resgatou, ganhou da equipe) equipa sempre — mesmo
 *    com a colecao fora do ar;
 *  - item gratis sem exigencia de resgate equipa enquanto estiver no ar;
 *  - o resto (pago sem posse, gratis que pede resgate sem posse) nao.
 */
export function podeEquiparItem(params: {
  precoMoedas: number | null;
  colecao: ColecaoRow | null | undefined;
  temPosse: boolean;
  agora: Date;
}): boolean {
  const { precoMoedas, colecao, temPosse, agora } = params;
  if (temPosse) return true;
  if (precoMoedas != null) return false;
  if (exigeResgate(precoMoedas, colecao)) return false;
  return itemNoAr(colecao, agora);
}

/** A colecao como a LOJA a ve. */
export interface ColecaoDaLoja {
  id: string;
  slug: string;
  nome: string;
  descricao: string | null;
  /** ISO, ou `null` sem prazo */
  fimEm: string | null;
  destaque: boolean;
  ordem: number;
}

/** A colecao como o PAINEL DA EQUIPE a ve. */
export interface ColecaoNoPainel extends ColecaoDaLoja {
  /** ISO, ou `null` */
  inicioEm: string | null;
  ativa: boolean;
  /** quantos itens estao nela */
  itens: number;
}

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

/**
 * "Sai em 5h", "Sai em 3 dias" — o selo de prazo, contado do instante e nao
 * do calendario (o fim pode cair de madrugada, e "sai amanha" as 23h de hoje
 * seria mentira). `null` sem prazo ou com o prazo ja passado.
 */
export function rotuloDoPrazo(fimEm: string | null, agora: Date): string | null {
  if (!fimEm) return null;
  const falta = new Date(fimEm).getTime() - agora.getTime();
  if (falta <= 0) return null;
  if (falta < DIA_MS) return `Sai em ${Math.ceil(falta / HORA_MS)}h`;
  return `Sai em ${Math.ceil(falta / DIA_MS)} dias`;
}
