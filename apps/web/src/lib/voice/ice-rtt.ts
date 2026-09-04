/**
 * RTT da conexao de voz a partir do par de candidatos ICE.
 *
 * Modulo separado e SEM dependencia do livekit-client de proposito: e a parte
 * pura da medicao de ping, exercitavel em teste sem arrastar o runtime de
 * WebRTC. `connection-stats.ts` liga isto na `RTCPeerConnection` da sessao.
 */

interface ParUsavel {
  rttMs: number;
  /** true quando o caminho passa por um servidor TURN (detour, RTT inflado). */
  relay: boolean;
  /** o par que o ICE marcou como em uso agora. */
  selecionado: boolean;
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
 *
 * O passo 2/3 existe porque a `RTCPeerConnection` pode manter mais de um par
 * `succeeded` (ex.: um direto e um relay), e as vezes o "selecionado" no
 * relatorio e o relay — que roteia por um TURN distante e infla o numero
 * (foi o que fazia o ping pular de ~7ms para ~120ms).
 */
export function rttDoRelatorio(report: RTCStatsReport): number | null {
  let selectedId: string | undefined;
  const pares: RTCIceCandidatePairStats[] = [];
  const porId = new Map<string, RTCIceCandidatePairStats>();
  const tipoDoCandidato = new Map<string, string>();

  report.forEach((s) => {
    switch (s.type) {
      case "transport": {
        const id = (s as RTCTransportStats).selectedCandidatePairId;
        if (typeof id === "string") selectedId = id;
        break;
      }
      case "candidate-pair": {
        const par = s as RTCIceCandidatePairStats;
        pares.push(par);
        if (typeof par.id === "string") porId.set(par.id, par);
        break;
      }
      case "local-candidate":
      case "remote-candidate": {
        const c = s as { id?: string; candidateType?: string };
        if (typeof c.id === "string" && typeof c.candidateType === "string") {
          tipoDoCandidato.set(c.id, c.candidateType);
        }
        break;
      }
    }
  });

  const ehRelay = (par: RTCIceCandidatePairStats): boolean =>
    tipoDoCandidato.get(par.localCandidateId ?? "") === "relay" ||
    tipoDoCandidato.get(par.remoteCandidateId ?? "") === "relay";

  const selecionadoDoFirefox = pares.find(
    (p) => (p as { selected?: boolean }).selected === true,
  );

  const usaveis: ParUsavel[] = [];
  for (const par of pares) {
    const rtt = par.currentRoundTripTime;
    // `> 0`: entre uma checagem STUN e a proxima o campo vem 0 ou ausente.
    if (typeof rtt !== "number" || rtt <= 0) continue;
    // So conta par que de fato vingou.
    const ok =
      par.state === "succeeded" ||
      par.id === selectedId ||
      par === selecionadoDoFirefox;
    if (!ok) continue;

    usaveis.push({
      rttMs: Math.round(rtt * 1000),
      relay: ehRelay(par),
      selecionado: par.id === selectedId || par === selecionadoDoFirefox,
    });
  }

  if (usaveis.length === 0) return null;

  const selDireto = usaveis.find((p) => p.selecionado && !p.relay);
  if (selDireto) return selDireto.rttMs;

  const diretos = usaveis.filter((p) => !p.relay);
  if (diretos.length > 0) {
    return Math.min(...diretos.map((p) => p.rttMs));
  }

  return Math.min(...usaveis.map((p) => p.rttMs));
}
