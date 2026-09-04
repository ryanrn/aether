import { describe, expect, it } from "vitest";
import { rttDoRelatorio } from "@/lib/voice/ice-rtt";

/**
 * O ping do painel de Conexao.
 *
 * Historia: primeiro vinha de `getSenderStats().roundTripTime` (RTCP do audio,
 * esparso e inflado — ~117ms fixo). Trocou para o `currentRoundTripTime` do par
 * de candidatos ICE. Ai apareceu ~7ms (correto!), mas as vezes pulava para
 * ~120ms: o par "selecionado" no relatorio as vezes e um RELAY (TURN), que
 * roteia por um servidor distante. Agora a funcao ignora o relay quando ha um
 * caminho direto.
 *
 * `rttDoRelatorio` e a parte pura. Um `Map` serve de dublê do RTCStatsReport
 * (so `forEach` e usado); a chave do Map vira o `id` de cada stat.
 */

function report(
  entries: Record<string, Record<string, unknown>>,
): RTCStatsReport {
  const m = new Map(
    Object.entries(entries).map(([id, stat]) => [id, { id, ...stat }]),
  );
  return m as unknown as RTCStatsReport;
}

const HOST_LOCAL = { type: "local-candidate", candidateType: "host" };
const HOST_REMOTE = { type: "remote-candidate", candidateType: "host" };
const RELAY_LOCAL = { type: "local-candidate", candidateType: "relay" };

describe("rttDoRelatorio", () => {
  it("par selecionado direto: usa o RTT dele", () => {
    const r = report({
      T1: { type: "transport", selectedCandidatePairId: "P" },
      L: HOST_LOCAL,
      R: HOST_REMOTE,
      P: {
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "L",
        remoteCandidateId: "R",
        currentRoundTripTime: 0.007,
      },
    });
    expect(rttDoRelatorio(r)).toBe(7);
  });

  it("converte segundos -> ms e arredonda", () => {
    const r = report({
      T1: { type: "transport", selectedCandidatePairId: "P" },
      P: {
        type: "candidate-pair",
        state: "succeeded",
        currentRoundTripTime: 0.1173,
      },
    });
    expect(rttDoRelatorio(r)).toBe(117);
  });

  it("selecionado e RELAY, existe um direto: usa o direto (o caso ~7 vs ~120)", () => {
    const r = report({
      T1: { type: "transport", selectedCandidatePairId: "P_relay" },
      L_relay: RELAY_LOCAL,
      L_host: HOST_LOCAL,
      R: HOST_REMOTE,
      P_relay: {
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "L_relay",
        remoteCandidateId: "R",
        currentRoundTripTime: 0.12,
      },
      P_host: {
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "L_host",
        remoteCandidateId: "R",
        currentRoundTripTime: 0.007,
      },
    });
    expect(rttDoRelatorio(r)).toBe(7);
  });

  it("so ha caminho relay: usa o relay (real, ainda que pior)", () => {
    const r = report({
      T1: { type: "transport", selectedCandidatePairId: "P" },
      L: RELAY_LOCAL,
      P: {
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "L",
        currentRoundTripTime: 0.09,
      },
    });
    expect(rttDoRelatorio(r)).toBe(90);
  });

  it("varios diretos succeeded: pega o menor", () => {
    const r = report({
      A: {
        type: "candidate-pair",
        state: "succeeded",
        currentRoundTripTime: 0.04,
      },
      B: {
        type: "candidate-pair",
        state: "succeeded",
        currentRoundTripTime: 0.011,
      },
    });
    expect(rttDoRelatorio(r)).toBe(11);
  });

  it("respeita o `selected` do Firefox", () => {
    const r = report({
      A: {
        type: "candidate-pair",
        selected: false,
        currentRoundTripTime: 0.3,
      },
      B: {
        type: "candidate-pair",
        selected: true,
        currentRoundTripTime: 0.018,
      },
    });
    expect(rttDoRelatorio(r)).toBe(18);
  });

  it("currentRoundTripTime ausente -> null (nao '0 ms')", () => {
    const r = report({
      T1: { type: "transport", selectedCandidatePairId: "P" },
      P: { type: "candidate-pair", state: "succeeded" },
    });
    expect(rttDoRelatorio(r)).toBeNull();
  });

  it("currentRoundTripTime 0 -> null (entre checagens STUN)", () => {
    const r = report({
      T1: { type: "transport", selectedCandidatePairId: "P" },
      P: {
        type: "candidate-pair",
        state: "succeeded",
        currentRoundTripTime: 0,
      },
    });
    expect(rttDoRelatorio(r)).toBeNull();
  });

  it("par nao-succeeded e nao-selecionado e ignorado", () => {
    const r = report({
      P: {
        type: "candidate-pair",
        state: "in-progress",
        currentRoundTripTime: 0.02,
      },
    });
    expect(rttDoRelatorio(r)).toBeNull();
  });

  it("relatorio sem candidate-pair -> null", () => {
    const r = report({
      X: { type: "outbound-rtp", kind: "audio", packetsSent: 100 },
    });
    expect(rttDoRelatorio(r)).toBeNull();
  });
});
