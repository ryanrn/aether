/**
 * RTT da conexao de voz a partir do par de candidatos ICE.
 *
 * Modulo separado e SEM dependencia do livekit-client de proposito: e a parte
 * pura da medicao de ping, exercitavel em teste sem arrastar o runtime de
 * WebRTC. `connection-stats.ts` liga isto na `RTCPeerConnection` da sessao.
 */

/** Um par de candidatos ja lido e classificado. */
export interface ParDeCandidatos {
  id?: string;
  state?: string;
  nominated?: boolean;
  /** o par que o ICE diz estar em uso agora */
  selecionado: boolean;
  /** `currentRoundTripTime` em ms; `null` quando ainda nao foi medido */
  rttMs: number | null;
  /** host | srflx | prflx | relay — o "relay" e TURN, e infla o RTT */
  tipoLocal?: string;
  tipoRemoto?: string;
  protocolo?: string;
  /**
   * Quantas respostas de STUN este par ja recebeu. Diferencia "medicao viva"
   * de "numero congelado no aperto de mao inicial".
   */
  respostas?: number;
  /**
   * Bytes que JA PASSARAM por este par. E o discriminador que importa: o
   * caminho por onde a midia corre de verdade e o que tem trafego.
   */
  bytesEnviados?: number;
  bytesRecebidos?: number;
  /**
   * IPv4 ou IPv6, derivado do endereco do candidato LOCAL (endereco de IPv6
   * tem ":"). So a familia e guardada — o endereco em si nunca sai daqui.
   *
   * Importa porque a maquina pode ter caminho bom por uma familia e ruim pela
   * outra para o MESMO servidor, e o ICE escolhe por prioridade, nao por
   * latencia.
   */
  familia?: "IPv4" | "IPv6";
  /**
   * RTT MEDIO de todas as respostas de STUN ja recebidas neste par
   * (`totalRoundTripTime / responsesReceived`).
   *
   * E o campo que desempata "o caminho custa isso" de "uma amostra deu isso":
   * `rttMs` e so a ULTIMA medicao. Media de 5ms com ultima de 119ms significa
   * caminho rapido com uma amostra atrasada; media de 119ms significa que o
   * caminho custa 119ms mesmo.
   */
  rttMedioMs: number | null;
  /** quantas checagens de STUN ja foram ENVIADAS neste par */
  requisicoes?: number;
}

/**
 * Le o relatorio uma vez e devolve todos os pares ja classificados.
 *
 * NAO expoe endereco nenhum — so o TIPO do candidato (host/srflx/relay) e o
 * protocolo. O diagnostico que a pessoa copia nao pode carregar o IP dela.
 */
export function paresDoRelatorio(report: RTCStatsReport): ParDeCandidatos[] {
  let selectedId: string | undefined;
  const brutos: RTCIceCandidatePairStats[] = [];
  const tipoDoCandidato = new Map<string, string>();
  const protocoloDoCandidato = new Map<string, string>();
  const familiaDoCandidato = new Map<string, "IPv4" | "IPv6">();

  report.forEach((s) => {
    switch (s.type) {
      case "transport": {
        const id = (s as RTCTransportStats).selectedCandidatePairId;
        if (typeof id === "string") selectedId = id;
        break;
      }
      case "candidate-pair":
        brutos.push(s as RTCIceCandidatePairStats);
        break;
      case "local-candidate":
      case "remote-candidate": {
        const c = s as {
          id?: string;
          candidateType?: string;
          protocol?: string;
          address?: string;
        };
        if (typeof c.id !== "string") break;
        if (typeof c.candidateType === "string") {
          tipoDoCandidato.set(c.id, c.candidateType);
        }
        if (typeof c.protocol === "string") {
          protocoloDoCandidato.set(c.id, c.protocol);
        }
        // So a FAMILIA fica guardada; o endereco morre aqui dentro.
        if (typeof c.address === "string" && c.address.length > 0) {
          familiaDoCandidato.set(c.id, c.address.includes(":") ? "IPv6" : "IPv4");
        }
        break;
      }
    }
  });

  return brutos.map((par) => {
    const p = par as RTCIceCandidatePairStats & {
      selected?: boolean;
      responsesReceived?: number;
      totalRoundTripTime?: number;
      requestsSent?: number;
    };
    const rtt = par.currentRoundTripTime;
    const total = p.totalRoundTripTime;
    const respostas = p.responsesReceived;
    const medio =
      typeof total === "number" && typeof respostas === "number" && respostas > 0
        ? Math.round((total / respostas) * 1000)
        : null;
    return {
      id: par.id,
      state: par.state,
      nominated: par.nominated,
      selecionado: par.id === selectedId || p.selected === true,
      // `> 0`: entre uma checagem STUN e a proxima o campo vem 0 ou ausente.
      rttMs: typeof rtt === "number" && rtt > 0 ? Math.round(rtt * 1000) : null,
      tipoLocal: tipoDoCandidato.get(par.localCandidateId ?? ""),
      tipoRemoto: tipoDoCandidato.get(par.remoteCandidateId ?? ""),
      protocolo: protocoloDoCandidato.get(par.localCandidateId ?? ""),
      respostas: p.responsesReceived,
      bytesEnviados: par.bytesSent,
      bytesRecebidos: par.bytesReceived,
      familia: familiaDoCandidato.get(par.localCandidateId ?? ""),
      rttMedioMs: medio,
      requisicoes: p.requestsSent,
    };
  });
}

/** O caminho passa por um TURN? Ai o RTT inclui o desvio. */
function ehRelay(par: ParDeCandidatos): boolean {
  return par.tipoLocal === "relay" || par.tipoRemoto === "relay";
}

/**
 * Dado um `RTCStatsReport`, o RTT (ms) do par de candidatos por onde a chamada
 * REALMENTE corre, ou `null` quando ainda nao ha medicao.
 *
 * `currentRoundTripTime` e o round-trip das checagens STUN de consentimento
 * ate o outro lado (aqui, o SFU) — a latencia REAL da rede. Vem em SEGUNDOS.
 */
export function rttDoRelatorio(report: RTCStatsReport): number | null {
  return rttDosPares(paresDoRelatorio(report));
}

/**
 * Qual par representa a chamada.
 *
 * NAO da para confiar em `transport.selectedCandidatePairId`. Medido em
 * producao, numa maquina com mais de uma interface de rede (adaptador virtual
 * de VPN/Hyper-V/WSL ao lado da placa real), o relatorio trazia TRES pares
 * `succeeded` ao mesmo tempo:
 *
 *   host  -> host   121ms   1 resposta    (congelado no aperto de mao)
 *   host  -> host   117ms   5 respostas   <- o "selecionado"
 *   prflx -> host     5ms   3 respostas   <- o caminho real da internet
 *
 * Os `host` sao a interface virtual; o `prflx` (peer-reflexive, descoberto
 * atraves do NAT) e por onde a midia corre. Seguir o "selecionado" mostrava
 * 117ms numa chamada de 5ms.
 *
 * O discriminador honesto e o TRAFEGO: o par por onde a midia passa e o que
 * tem bytes. Isso nao e escolher o numero mais bonito — e medir o caminho
 * certo. A ordem:
 *
 *  1. entre os pares vivos, o que mais MOVEU BYTES (o da chamada);
 *  2. empate ou sem contagem de bytes: o par SELECIONADO;
 *  3. sem nenhum dos dois: o menor RTT (ainda melhor que um valor congelado).
 *
 * Pares via relay (TURN) so entram se nao houver caminho direto: o RTT deles
 * inclui o desvio pelo servidor TURN.
 */
export function rttDosPares(pares: ParDeCandidatos[]): number | null {
  const vivos = pares.filter(
    (p) => p.rttMs !== null && (p.state === "succeeded" || p.selecionado),
  );
  if (vivos.length === 0) return null;

  const diretos = vivos.filter((p) => !ehRelay(p));
  const alvo = diretos.length > 0 ? diretos : vivos;

  const comTrafego = alvo.filter((p) => (p.bytesEnviados ?? 0) > 0);
  if (comTrafego.length > 0) {
    const carregando = comTrafego.reduce((a, b) =>
      (b.bytesEnviados ?? 0) > (a.bytesEnviados ?? 0) ? b : a,
    );
    return carregando.rttMs;
  }

  const selecionado = alvo.find((p) => p.selecionado);
  if (selecionado) return selecionado.rttMs;

  return Math.min(...alvo.map((p) => p.rttMs as number));
}
