import { describe, expect, it } from "vitest";
import { rttDoRelatorio } from "@/lib/voice/ice-rtt";

/**
 * O ping do painel de Conexao (correcao: vinha inflado ~117ms).
 *
 * Antes o RTT saia de `getSenderStats().roundTripTime` — o RTT do RTCP do
 * AUDIO, esparso e sistematicamente alto. Agora sai do `currentRoundTripTime`
 * do par de candidatos ICE ativo: a latencia real da rede ate o SFU.
 *
 * `rttDoRelatorio` e a parte pura: dado um RTCStatsReport, devolve o RTT em ms
 * do par certo, ou null quando ainda nao ha medicao. Um `Map` serve de dublê
 * do report (tem `forEach`, que e tudo que a funcao usa); a chave do Map vira
 * o `id` de cada stat, como num relatorio de verdade.
 */

function report(
  entries: Record<string, Record<string, unknown>>,
): RTCStatsReport {
  const m = new Map(
    Object.entries(entries).map(([id, stat]) => [id, { id, ...stat }]),
  );
  return m as unknown as RTCStatsReport;
}

describe("rttDoRelatorio", () => {
  it("segue o transport.selectedCandidatePairId", () => {
    const r = report({
      T1: { type: "transport", selectedCandidatePairId: "P_boa" },
      P_ruim: {
        type: "candidate-pair",
        nominated: true,
        state: "succeeded",
        currentRoundTripTime: 0.5,
      },
      P_boa: {
        type: "candidate-pair",
        state: "succeeded",
        currentRoundTripTime: 0.004,
      },
    });
    expect(rttDoRelatorio(r)).toBe(4);
  });

  it("converte segundos -> ms e arredonda", () => {
    const r = report({
      T1: { type: "transport", selectedCandidatePairId: "P1" },
      P1: { type: "candidate-pair", currentRoundTripTime: 0.1173 },
    });
    expect(rttDoRelatorio(r)).toBe(117);
  });

  it("sem transport, cai para o par nominated + succeeded", () => {
    const r = report({
      P_fail: {
        type: "candidate-pair",
        nominated: true,
        state: "failed",
        currentRoundTripTime: 0.9,
      },
      P_ok: {
        type: "candidate-pair",
        nominated: true,
        state: "succeeded",
        currentRoundTripTime: 0.021,
      },
    });
    expect(rttDoRelatorio(r)).toBe(21);
  });

  it("respeita o `selected` do Firefox quando nao ha transport", () => {
    const r = report({
      A: { type: "candidate-pair", selected: false, currentRoundTripTime: 0.3 },
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
      T1: { type: "transport", selectedCandidatePairId: "P1" },
      P1: { type: "candidate-pair", state: "succeeded", nominated: true },
    });
    expect(rttDoRelatorio(r)).toBeNull();
  });

  it("currentRoundTripTime 0 -> null (entre checagens STUN)", () => {
    const r = report({
      T1: { type: "transport", selectedCandidatePairId: "P1" },
      P1: { type: "candidate-pair", currentRoundTripTime: 0 },
    });
    expect(rttDoRelatorio(r)).toBeNull();
  });

  it("relatorio sem nenhum candidate-pair -> null", () => {
    const r = report({
      X: { type: "outbound-rtp", kind: "audio", packetsSent: 100 },
    });
    expect(rttDoRelatorio(r)).toBeNull();
  });

  it("selectedCandidatePairId aponta para id inexistente -> cai no fallback", () => {
    const r = report({
      T1: { type: "transport", selectedCandidatePairId: "sumiu" },
      P1: {
        type: "candidate-pair",
        nominated: true,
        state: "succeeded",
        currentRoundTripTime: 0.033,
      },
    });
    expect(rttDoRelatorio(r)).toBe(33);
  });
});
