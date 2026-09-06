/**
 * Versao dos documentos legais.
 *
 * `aceitouTermosEm` sozinho nao basta: quando os Termos mudam DE VERDADE (nao
 * um ajuste de virgula), a versao aqui sobe e todo mundo com a anterior ve o
 * modal de re-aceite de novo. Guardar a versao aceita permite isso sem forcar
 * re-aceite a cada deploy.
 *
 * FORMATO: a data da ultima mudanca material, `AAAA-MM-DD`. Legivel, ordenavel,
 * e diz por si quando foi.
 *
 * MORA NO SHARED porque a regra "precisa re-aceitar?" e checada no servidor
 * (guard) e refletida no cliente (o modal), e as duas nao podem discordar.
 */
export const VERSAO_DOS_TERMOS = "2026-09-06";

/** Os tres documentos, para o rodape e o modal montarem os links. */
export const DOCUMENTOS_LEGAIS = [
  { slug: "termos", titulo: "Termos de Uso" },
  { slug: "privacidade", titulo: "Política de Privacidade" },
  { slug: "conteudo", titulo: "Política de Conteúdo" },
] as const;

/** Precisa (re)aceitar os termos? Nulo ou versao antiga = sim. */
export function precisaAceitarTermos(user: {
  aceitouTermosEm: Date | null;
  termosVersao: string | null;
}): boolean {
  if (!user.aceitouTermosEm) return true;
  return user.termosVersao !== VERSAO_DOS_TERMOS;
}
