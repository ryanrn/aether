/**
 * O que espera a equipe.
 *
 * Duas filas com origens diferentes — jogos que a comunidade ensinou ao app e
 * servidores que pediram vitrine — mas UM aviso so, porque quem revisa e a
 * mesma pessoa e ela olha um lugar so: a engrenagem da barra de baixo.
 *
 * MORA NO SHARED, e nao no `apps/web`, porque a forma e contrato entre a
 * action e a tela. Se um dia o gateway precisar avisar em tempo real que
 * chegou pedido novo, ele ja tem o mesmo tipo — sem uma segunda definicao
 * capaz de divergir.
 */
export interface RevisoesPendentes {
  /** Sugestoes de jogo em PENDENTE. */
  jogos: number;
  /** Pedidos de vitrine em PENDENTE. */
  comunidades: number;
  /** Denuncias de abuso em ABERTA. */
  denuncias: number;
}

/**
 * O total, que e o que o numerinho mostra.
 *
 * Funcao, e nao `a + b` espalhado pelas telas: a soma aparece na engrenagem e
 * no texto do `title`, e duas somas escritas a mao sao duas chances de uma
 * delas esquecer uma fila nova.
 */
export function totalDeRevisoes(
  pendentes: RevisoesPendentes | null | undefined,
): number {
  if (!pendentes) return 0;
  return (
    (pendentes.jogos ?? 0) +
    (pendentes.comunidades ?? 0) +
    (pendentes.denuncias ?? 0)
  );
}

/**
 * O rotulo do numerinho.
 *
 * TETO DE 9: o marcador tem 14px e mora na quina de um botao de 32px. Com
 * tres digitos ele encosta no botao vizinho — e, para quem revisa, "10" e
 * "137" pedem a mesma acao (abrir a fila). O numero exato esta la dentro.
 */
export function rotuloDeRevisoes(total: number): string {
  return total > 9 ? "9+" : String(total);
}
