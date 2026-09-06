/**
 * Dado o que o membro tem e o que deveria ter, o que muda.
 *
 * Funcao pura, em arquivo proprio (sem prisma, sem estado) para ter teste: e
 * o coracao da sincronizacao do cargo por jogo e o tipo de logica que erra em
 * silencio — adiciona sem remover, remove o cargo certo pelo motivo errado.
 */
export function diffDeCargos(
  atuais: Iterable<string>,
  alvo: Iterable<string>,
): { aAdicionar: string[]; aRemover: string[] } {
  const setAtuais = new Set(atuais);
  const setAlvo = new Set(alvo);
  return {
    aAdicionar: [...setAlvo].filter((id) => !setAtuais.has(id)),
    aRemover: [...setAtuais].filter((id) => !setAlvo.has(id)),
  };
}
