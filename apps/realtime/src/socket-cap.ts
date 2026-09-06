/**
 * Teto de conexoes por usuario — a parte pura.
 *
 * O `index.ts` chama isto depois de anexar o socket novo ao estado, com a
 * lista COMPLETA de sockets do usuario (ja incluindo o recem-chegado), e
 * desconecta o que voltar daqui.
 *
 * POR QUE DESCONECTAR O VELHO, e nao recusar o novo: recusar penaliza a
 * reconexao — uma queda de rede deixa o socket velho como zumbi por ate 8s
 * (pingTimeout), e nesse meio-tempo o cliente legitimo tentando voltar levaria
 * "no seu limite". A mesma licao do rate limit, que parou de chavear por
 * conexao justamente para reconectar nao virar bypass nem punicao.
 *
 * A ORDEM da lista nao e confiavel entre backends (o Set em memoria preserva
 * insercao; o `SMEMBERS` do Redis nao promete nada). Por isso a escolha da
 * vitima e "os primeiros da lista, menos o atual" — arbitraria mas estavel, e
 * o alvo exato nao importa: um usuario com 8+ sockets vivos ja e anomalia.
 */
export function socketsAcimaDoTeto(
  todosOsSockets: readonly string[],
  socketAtual: string,
  teto: number,
): string[] {
  // teto 0 = desligado; lista dentro do limite = nada a fazer.
  if (teto <= 0 || todosOsSockets.length <= teto) return [];

  const excedente = todosOsSockets.length - teto;
  const outros = todosOsSockets.filter((id) => id !== socketAtual);

  // Nunca devolve o socket atual: ele acabou de ser aceito e anexado.
  return outros.slice(0, excedente);
}
