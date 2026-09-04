/**
 * RTT da conexao de voz a partir do par de candidatos ICE.
 *
 * Modulo separado e SEM dependencia do livekit-client de proposito: e a parte
 * pura da medicao de ping, exercitavel em teste sem arrastar o runtime de
 * WebRTC. `connection-stats.ts` liga isto na `RTCPeerConnection` da sessao.
 */

/**
 * Dado um `RTCStatsReport`, o RTT (ms) do par de candidatos ICE ATIVO, ou
 * `null` quando ainda nao ha medicao.
 *
 * `currentRoundTripTime` e o round-trip das checagens STUN de consentimento
 * ate o outro lado (aqui, o SFU) — a latencia REAL da rede. Vem em SEGUNDOS.
 *
 * Escolha do par (a mesma ordem que o livekit-client usa internamente):
 *  1. o par apontado por `transport.selectedCandidatePairId`;
 *  2. senao, um par com `selected === true` (Firefox);
 *  3. senao, um par `nominated` e `succeeded`.
 */
export function rttDoRelatorio(report: RTCStatsReport): number | null {
  let selectedId: string | undefined;
  const pares: RTCIceCandidatePairStats[] = [];
  // Proprio indice por id: `RTCStatsReport` so garante `forEach` no tipo do
  // DOM (mesmo sendo um Map em runtime) — nao da para depender de `.get()`.
  const porId = new Map<string, RTCIceCandidatePairStats>();

  report.forEach((s) => {
    if (s.type === "transport") {
      const id = (s as RTCTransportStats).selectedCandidatePairId;
      if (typeof id === "string") selectedId = id;
    } else if (s.type === "candidate-pair") {
      const par = s as RTCIceCandidatePairStats;
      pares.push(par);
      if (typeof par.id === "string") porId.set(par.id, par);
    }
  });

  const escolhido =
    (selectedId ? porId.get(selectedId) : undefined) ??
    pares.find((p) => (p as { selected?: boolean }).selected === true) ??
    pares.find((p) => p.nominated === true && p.state === "succeeded");

  const rtt = escolhido?.currentRoundTripTime;
  // `> 0`: entre uma checagem STUN e a proxima o campo pode vir 0 ou ausente —
  // isso e "ainda nao sei" (null), nao "0 ms".
  return typeof rtt === "number" && rtt > 0 ? Math.round(rtt * 1000) : null;
}
