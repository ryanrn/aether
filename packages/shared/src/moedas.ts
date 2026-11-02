/**
 * A moeda da loja (Estagio 1 da economia).
 *
 * O NOME mora aqui, e so aqui — como o nome do produto em `brand.ts`. Toda
 * tela le `MOEDA`; trocar "moedas" por outro nome e mudar este objeto.
 */
export const MOEDA = {
  singular: "moeda",
  plural: "moedas",
} as const;

/** "1 moeda", "250 moedas", com separador de milhar em pt-BR. */
export function formatarMoedas(valor: number): string {
  const n = Math.abs(valor);
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? MOEDA.singular : MOEDA.plural}`;
}

/**
 * Teto de uma concessao da equipe, para mais ou para menos. Erro de digitacao
 * (um zero a mais) nao pode virar a economia de cabeca para baixo.
 */
export const CONCESSAO_MAXIMA = 100_000;

export type MotivoDeMoedas = "COMPRA" | "CONCESSAO_EQUIPE" | "MISSAO";

export const MOTIVO_LABEL: Record<MotivoDeMoedas, string> = {
  COMPRA: "Compra na loja",
  CONCESSAO_EQUIPE: "Enviado pela equipe",
  MISSAO: "Missão concluída",
};

/** Uma linha do extrato, como a tela recebe. */
export interface MovimentoPublico {
  id: string;
  valor: number;
  saldoDepois: number;
  motivo: MotivoDeMoedas;
  /** o que explica o movimento, ja resolvido: o nome do item, a nota da equipe */
  descricao: string | null;
  createdAt: string;
}

export interface Carteira {
  saldo: number;
  movimentos: MovimentoPublico[];
}
