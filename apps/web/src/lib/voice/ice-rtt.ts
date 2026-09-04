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
        };
        if (typeof c.id !== "string") break;
        if (typeof c.candidateType === "string") {
          tipoDoCandidato.set(c.id, c.candidateType);
        }
        if (typeof c.protocol === "string") {
          protocoloDoCandidato.set(c.id, c.protocol);
        }
        break;
      }
    }
  });

  return brutos.map((par) => {
    const p = par as RTCIceCandidatePairStats & {
      selected?: boolean;
      responsesReceived?: number;
    };
    const rtt = par.currentRoundTripTime;
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
    };
  });
}

/** O caminho passa por um TURN? Ai o RTT inclui o desvio. */
function ehRelay(par: ParDeCandidatos): boolean {
  return par.tipoLocal === "relay" || par.tipoRemoto === "relay";
}

/**
 * Dado um `RTCStatsReport`, o RTT (ms) do melhor par de candidatos ICE, ou
 * `null` quando ainda nao ha medicao.
 *
 * `currentRoundTripTime` e o round-trip das checagens STUN de consentimento
 * ate o outro lado (aqui, o SFU) — a latencia REAL da rede. Vem em SEGUNDOS.
 *
 * Escolha:
 *  1. par SELECIONADO, se for direto (nao-relay) e tiver RTT;
 *  2. senao, o menor RTT entre os pares diretos que deram `succeeded`;
 *  3. senao, o menor RTT entre os pares via relay (TURN) — pior, mas real;
 *  4. senao, `null`.
 */
export function rttDoRelatorio(report: RTCStatsReport): number | null {
  return rttDosPares(paresDoRelatorio(report));
}

export function rttDosPares(pares: ParDeCandidatos[]): number | null {
  const usaveis = pares.filter(
    (p) => p.rttMs !== null && (p.state === "succeeded" || p.selecionado),
  );
  if (usaveis.length === 0) return null;

  const selDireto = usaveis.find((p) => p.selecionado && !ehRelay(p));
  if (selDireto) return selDireto.rttMs;

  const diretos = usaveis.filter((p) => !ehRelay(p));
  const alvo = diretos.length > 0 ? diretos : usaveis;
  return Math.min(...alvo.map((p) => p.rttMs as number));
}
