/**
 * Denuncia de abuso — a forma que a action e a tela compartilham.
 *
 * MORA NO SHARED (nao em `apps/web`) porque `DenunciaNaFila` e contrato entre
 * o service (produz), a action (repassa) e o componente de cliente da tela da
 * equipe (consome) — e este ultimo nao pode importar de `server-only`. Mesmo
 * motivo do `FlagParaAdmin`.
 *
 * Os tipos de string aqui espelham os enums do Prisma (`AlvoDeDenuncia`,
 * `StatusDeDenuncia`). Sao literalmente as mesmas strings; duplicar a uniao
 * evita `@aether/shared` depender de `@aether/db`.
 */

export type TipoDeDenuncia = "MENSAGEM" | "USUARIO" | "SERVIDOR";
export type StatusDeDenuncia = "ABERTA" | "EM_ANALISE" | "RESOLVIDA" | "DESCARTADA";

/** Motivos que o formulario oferece. O `outro` sempre por ultimo. */
export const MOTIVOS_DE_DENUNCIA = [
  { valor: "spam", rotulo: "Spam ou propaganda" },
  { valor: "assedio", rotulo: "Assédio ou ameaça" },
  { valor: "conteudo", rotulo: "Conteúdo impróprio ou ilegal" },
  { valor: "impersonacao", rotulo: "Fingindo ser outra pessoa" },
  { valor: "outro", rotulo: "Outro" },
] as const;

export type MotivoDeDenuncia = (typeof MOTIVOS_DE_DENUNCIA)[number]["valor"];

export function motivoDeDenunciaValido(valor: string): valor is MotivoDeDenuncia {
  return MOTIVOS_DE_DENUNCIA.some((m) => m.valor === valor);
}

/** Uma linha da fila da equipe. */
export interface DenunciaNaFila {
  id: string;
  tipo: TipoDeDenuncia;
  alvoId: string;
  motivo: string;
  detalhe: string | null;
  /** o que o alvo dizia na hora da denuncia — o alvo pode ter sumido depois */
  snapshot: string | null;
  status: StatusDeDenuncia;
  notaEquipe: string | null;
  reporter: { id: string; displayName: string; username: string } | null;
  /**
   * O userId por tras do alvo: autor da mensagem, o proprio usuario, ou o dono
   * do servidor. `null` se o alvo sumiu. E o que "silenciar autor" usa.
   */
  autorDoAlvoId: string | null;
  /** quantas denuncias existem sobre este mesmo alvo (reincidencia) */
  totalSobreAlvo: number;
  createdAt: string;
}
