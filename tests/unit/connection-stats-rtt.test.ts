import { describe, expect, it } from "vitest";
import { rttDoRelatorio } from "@/lib/voice/ice-rtt";

/**
 * O ping do painel de Conexao.
 *
 * Historia, em tres etapas:
 *  1. vinha de `getSenderStats().roundTripTime` (RTCP do audio) — ~117ms fixo;
 *  2. trocou para o `currentRoundTripTime` do par de candidatos ICE, seguindo
 *     `transport.selectedCandidatePairId`. Melhorou (apareceu 5ms) mas ainda
 *     pulava para ~117ms;
 *  3. o diagnostico de producao mostrou POR QUE: numa maquina com adaptador de
 *     rede virtual, ha varios pares `succeeded` ao mesmo tempo e o
 *     "selecionado" era o da interface virtual (117ms), nao o caminho real
 *     (`prflx`, 5ms). Agora a escolha segue o TRAFEGO (`bytesSent`).
 *
 * Um `Map` serve de dublê do RTCStatsReport (so `forEach` e usado); a chave do
 * Map vira o `id` de cada stat.
 */

function report(
  entries: Record<string, Record<string, unknown>>,
): RTCStatsReport {
  const m = new Map(
    Object.entries(entries).map(([id, stat]) => [id, { id, ...stat }]),
  );
  return m as unknown as RTCStatsReport;
}

const HOST_L = { type: "local-candidate", candidateType: "host" };
const HOST_L2 = { type: "local-candidate", candidateType: "host" };
const PRFLX_L = { type: "local-candidate", candidateType: "prflx" };
const RELAY_L = { type: "local-candidate", candidateType: "relay" };
const HOST_R = { type: "remote-candidate", candidateType: "host" };

describe("rttDoRelatorio", () => {
  /**
   * O caso EXATO capturado em producao (Chrome, maquina com placa virtual).
   * O par "selecionado" dava 117ms; a midia corria pelo prflx, a 5ms.
   */
  it("segue o trafego, nao o `selected` — caso real de 117ms vs 5ms", () => {
    const r = report({
      T1: { type: "transport", selectedCandidatePairId: "P_host_b" },
      L_host_a: HOST_L,
      L_host_b: HOST_L2,
      L_prflx: PRFLX_L,
      R: HOST_R,
      P_host_a: {
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "L_host_a",
        remoteCandidateId: "R",
        currentRoundTripTime: 0.121,
        responsesReceived: 1,
        bytesSent: 0,
      },
      P_host_b: {
        type: "candidate-pair",
        state: "succeeded",
        nominated: true,
        localCandidateId: "L_host_b",
        remoteCandidateId: "R",
        currentRoundTripTime: 0.117,
        responsesReceived: 5,
        bytesSent: 0,
      },
      P_prflx: {
        type: "candidate-pair",
        state: "succeeded",
        nominated: true,
        localCandidateId: "L_prflx",
        remoteCandidateId: "R",
        currentRoundTripTime: 0.005,
        responsesReceived: 3,
        bytesSent: 148_000,
      },
    });
    expect(rttDoRelatorio(r)).toBe(5);
  });

  it("converte segundos -> ms e arredonda", () => {
    const r = report({
      T1: { type: "transport", selectedCandidatePairId: "P" },
      P: {
        type: "candidate-pair",
        state: "succeeded",
        currentRoundTripTime: 0.1173,
        bytesSent: 900,
      },
    });
    expect(rttDoRelatorio(r)).toBe(117);
  });

  it("sem bytes em nenhum par, cai para o selecionado", () => {
    const r = report({
      T1: { type: "transport", selectedCandidatePairId: "P_sel" },
      P_outro: {
        type: "candidate-pair",
        state: "succeeded",
        currentRoundTripTime: 0.004,
      },
      P_sel: {
        type: "candidate-pair",
        state: "succeeded",
        currentRoundTripTime: 0.02,
      },
    });
    expect(rttDoRelatorio(r)).toBe(20);
  });

  it("sem bytes e sem selecionado, cai para o menor RTT", () => {
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

  it("ignora o relay quando ha caminho direto, mesmo com mais trafego", () => {
    const r = report({
      L_relay: RELAY_L,
      L_host: HOST_L,
      R: HOST_R,
      P_relay: {
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "L_relay",
        remoteCandidateId: "R",
        currentRoundTripTime: 0.12,
        bytesSent: 999_999,
      },
      P_host: {
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "L_host",
        remoteCandidateId: "R",
        currentRoundTripTime: 0.007,
        bytesSent: 10_000,
      },
    });
    expect(rttDoRelatorio(r)).toBe(7);
  });

  it("so ha caminho relay: usa o relay (real, ainda que pior)", () => {
    const r = report({
      L: RELAY_L,
      P: {
        type: "candidate-pair",
        state: "succeeded",
        localCandidateId: "L",
        currentRoundTripTime: 0.09,
        bytesSent: 5000,
      },
    });
    expect(rttDoRelatorio(r)).toBe(90);
  });

  it("respeita o `selected` do Firefox quando nao ha bytes", () => {
    const r = report({
      A: {
        type: "candidate-pair",
        state: "succeeded",
        selected: false,
        currentRoundTripTime: 0.3,
      },
      B: {
        type: "candidate-pair",
        state: "succeeded",
        selected: true,
        currentRoundTripTime: 0.018,
      },
    });
    expect(rttDoRelatorio(r)).toBe(18);
  });

  it("currentRoundTripTime ausente -> null (nao '0 ms')", () => {
    const r = report({
      T1: { type: "transport", selectedCandidatePairId: "P" },
      P: { type: "candidate-pair", state: "succeeded", bytesSent: 100 },
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
        bytesSent: 10,
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
