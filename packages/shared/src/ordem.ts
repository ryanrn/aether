/**
 * Reposiciona um item numa lista ordenada: tira de onde estiver e insere no
 * indice pedido (limitado ao tamanho da lista).
 *
 * Um lugar so para o SERVIDOR (que grava a ordem nova) e a TELA (que mostra a
 * ordem nova na hora, antes de o servidor responder). Duas contas diferentes
 * fariam o canal "pular" de lugar quando a resposta chegasse.
 */
export function reposicionar<T>(lista: readonly T[], item: T, indice: number): T[] {
  const semEle = lista.filter((x) => x !== item);
  const alvo = Math.max(0, Math.min(indice, semEle.length));
  return [...semEle.slice(0, alvo), item, ...semEle.slice(alvo)];
}
