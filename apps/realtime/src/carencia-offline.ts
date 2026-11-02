/**
 * Carencia antes de anunciar que alguem saiu (G-1).
 *
 * POR QUE EXISTE. O gateway anunciava OFFLINE no instante em que o ultimo
 * socket da pessoa caia. Uma oscilacao de rede de dois segundos — Wi-Fi
 * trocando de ponto, notebook acordando, celular saindo do elevador — fazia
 * a pessoa sumir e voltar para todo mundo, perder e ganhar de novo o cargo por
 * jogo, e piscar na lista de amigos. A referencia aberta estudada em
 * `docs/fluxer-research.md` segura alguns segundos antes de declarar offline;
 * a mesma ideia, implementada aqui do nosso jeito.
 *
 * O QUE ESPERA E O QUE NAO ESPERA. So o ANUNCIO atrasa. O estado de presenca
 * ja foi desmontado por `detachSocket` (quem consultar durante a carencia ve a
 * pessoa ausente); o que nao sai e o aviso de "saiu" para quem ja via ela
 * online. Se um socket dela voltar dentro do prazo, o aviso nunca acontece —
 * quem ja via online continua vendo, sem piscar.
 *
 * VARIAS INSTANCIAS. A decisao depois da espera consulta o estado de presenca
 * (`isConnected`, presenca por servidor), que mora no Redis quando ha mais de
 * um gateway — entao a pessoa que reconectou em OUTRA maquina tambem conta como
 * "voltou". O temporizador em si e local: se esta instancia morrer durante a
 * carencia, o anuncio se perde (mesmo comportamento de antes para qualquer
 * coisa em andamento num processo que cai).
 */

/** Padrao de 5 s; `PRESENCA_CARENCIA_MS=0` volta ao comportamento antigo. */
export function carenciaOfflineMs(): number {
  const bruto = Number(process.env.PRESENCA_CARENCIA_MS ?? 5000);
  return Number.isFinite(bruto) && bruto >= 0 ? bruto : 5000;
}

export interface DependenciasDaSaida {
  esperar: (ms: number) => Promise<void>;
  /** A pessoa tem algum socket em qualquer servidor, em qualquer instancia? */
  isConnected: (userId: string) => Promise<boolean>;
  /** A pessoa voltou a estar presente NESTE servidor? */
  estaNoServidor: (serverId: string, userId: string) => Promise<boolean>;
}

export interface SaidaConfirmada {
  /** Servidores onde ela continua ausente depois da carencia. */
  servidores: string[];
  /** Nao voltou em lugar nenhum: amigos e Spotify tambem sao avisados. */
  totalmenteFora: boolean;
}

/**
 * Espera a carencia e devolve o que AINDA precisa ser anunciado. Quem chama
 * faz os anuncios — este modulo so decide, para poder ser testado sem
 * Socket.IO.
 *
 * `servidoresDesocupados` e o que `detachSocket` devolveu: os servidores em
 * que este era o ultimo socket da pessoa.
 */
export async function confirmarSaida(
  userId: string,
  servidoresDesocupados: string[],
  carenciaMs: number,
  deps: DependenciasDaSaida,
): Promise<SaidaConfirmada> {
  if (carenciaMs > 0) await deps.esperar(carenciaMs);

  const presenca = await Promise.all(
    servidoresDesocupados.map((serverId) => deps.estaNoServidor(serverId, userId)),
  );
  const servidores = servidoresDesocupados.filter((_, i) => !presenca[i]);
  const totalmenteFora = !(await deps.isConnected(userId));
  return { servidores, totalmenteFora };
}
