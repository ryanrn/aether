import { describe, expect, it } from "vitest";
import { paresDoRelatorio, rttDoRelatorio } from "@/lib/voice/ice-rtt";
import { rttDaSessao } from "@/lib/voice/connection-stats";

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

/**
 * Os campos que o painel de Depuracao usa para EXPLICAR o ping.
 *
 * `rttMs` sozinho nao responde a pergunta que importa quando ele esta alto:
 * "esse caminho custa isso, ou foi uma amostra atrasada?". `rttMedioMs`
 * (media de todas as respostas de STUN) responde. E `familia` responde a
 * outra metade: o ICE escolhe par por PRIORIDADE, nao por latencia, e a mesma
 * maquina pode ter caminho otimo por IPv4 e pessimo por IPv6 para o mesmo
 * destino.
 */
describe("paresDoRelatorio — campos de diagnostico", () => {
  it("deriva a familia do endereco local sem guardar o endereco", () => {
    const pares = paresDoRelatorio(
      report({
        L4: { ...HOST_L, address: "192.168.15.9", protocol: "udp" },
        L6: { ...HOST_L, address: "2804:7f0:79c0:cf22::1", protocol: "udp" },
        R: HOST_R,
        P4: {
          type: "candidate-pair",
          state: "succeeded",
          localCandidateId: "L4",
          remoteCandidateId: "R",
          currentRoundTripTime: 0.006,
        },
        P6: {
          type: "candidate-pair",
          state: "succeeded",
          localCandidateId: "L6",
          remoteCandidateId: "R",
          currentRoundTripTime: 0.119,
        },
      }),
    );
    const p4 = pares.find((p) => p.id === "P4");
    const p6 = pares.find((p) => p.id === "P6");
    expect(p4?.familia).toBe("IPv4");
    expect(p6?.familia).toBe("IPv6");
    // O endereco nao pode vazar para o objeto que a pessoa copia.
    expect(JSON.stringify(pares)).not.toContain("192.168");
    expect(JSON.stringify(pares)).not.toContain("2804:");
  });

  it("media do RTT separa caminho ruim de amostra ruim", () => {
    const pares = paresDoRelatorio(
      report({
        L: { ...HOST_L, address: "10.0.0.2" },
        R: HOST_R,
        // Ultima checagem em 119ms, mas as 10 anteriores somam 60ms:
        // media de 6ms => o caminho e bom, a amostra e que atrasou.
        P_amostra: {
          type: "candidate-pair",
          state: "succeeded",
          localCandidateId: "L",
          remoteCandidateId: "R",
          currentRoundTripTime: 0.119,
          totalRoundTripTime: 0.06,
          responsesReceived: 10,
          requestsSent: 12,
        },
      }),
    );
    const p = pares[0];
    expect(p?.rttMs).toBe(119);
    expect(p?.rttMedioMs).toBe(6);
    expect(p?.requisicoes).toBe(12);
  });

  it("sem respostas, a media e null em vez de dividir por zero", () => {
    const pares = paresDoRelatorio(
      report({
        L: HOST_L,
        R: HOST_R,
        P: {
          type: "candidate-pair",
          state: "in-progress",
          localCandidateId: "L",
          remoteCandidateId: "R",
          totalRoundTripTime: 0,
          responsesReceived: 0,
        },
      }),
    );
    expect(pares[0]?.rttMedioMs).toBeNull();
    expect(pares[0]?.familia).toBeUndefined();
  });
});

/**
 * Qual das duas conexoes define o ping da sessao.
 *
 * Era `Math.min(publisher, subscriber)`. O menor das duas e o numero mais
 * bonito, nao a medicao certa: se o ENVIO esta a 119ms, e por 119ms que a voz
 * de quem esta falando sai, e mostrar o 5ms da outra esconderia justamente
 * isso. Agora manda o publisher; o subscriber so cobre quem nao publica.
 */
describe("rttDaSessao", () => {
  const rota = (pc: "publisher" | "subscriber", rttMs: number | null) => ({
    pc,
    pares: [],
    rttMs,
  });

  it("com as duas medindo, manda o PUBLISHER — mesmo sendo o maior", () => {
    expect(
      rttDaSessao([rota("publisher", 119), rota("subscriber", 5)]),
    ).toBe(119);
  });

  it("nao inverte quando o publisher e o menor", () => {
    expect(rttDaSessao([rota("publisher", 5), rota("subscriber", 119)])).toBe(5);
  });

  it("cai no subscriber quando o publisher nao tem medicao", () => {
    expect(rttDaSessao([rota("publisher", null), rota("subscriber", 42)])).toBe(
      42,
    );
  });

  it("cai no subscriber quando nem existe conexao de envio", () => {
    expect(rttDaSessao([rota("subscriber", 42)])).toBe(42);
  });

  it("sem nenhuma medicao, devolve null — nao 0 ms", () => {
    expect(rttDaSessao([])).toBeNull();
    expect(
      rttDaSessao([rota("publisher", null), rota("subscriber", null)]),
    ).toBeNull();
  });
});

/**
 * A assimetria deliberada dos enderecos.
 *
 * O endereco LOCAL e a maquina de quem esta na chamada e nao pode vazar num
 * texto colado em lugar nenhum — dele so a familia sobrevive. O REMOTO e o
 * servidor de midia, infraestrutura publica, e sem ele nao da para responder
 * "para onde essa midia esta indo?" quando o ping esta alto.
 */
describe("enderecos no diagnostico", () => {
  const pares = () =>
    paresDoRelatorio(
      report({
        L: {
          type: "local-candidate",
          candidateType: "host",
          address: "192.168.15.9",
          port: 54321,
          protocol: "udp",
        },
        R: {
          type: "remote-candidate",
          candidateType: "host",
          address: "147.15.30.223",
          port: 50005,
        },
        P: {
          type: "candidate-pair",
          state: "succeeded",
          localCandidateId: "L",
          remoteCandidateId: "R",
          currentRoundTripTime: 0.005,
        },
      }),
    );

  it("mostra o endereco do SERVIDOR, com porta", () => {
    expect(pares()[0]?.enderecoRemoto).toBe("147.15.30.223:50005");
  });

  it("IPv6 sai entre colchetes, para a porta nao se confundir", () => {
    const pares = paresDoRelatorio(
      report({
        L: { type: "local-candidate", candidateType: "host", address: "::1" },
        R: {
          type: "remote-candidate",
          candidateType: "host",
          // O caso real: SFU do LiveKit anunciando IPv6 alem do IPv4.
          address: "2603:c021:c006:a500::d83e:8bba:1765",
          port: 50006,
        },
        P: {
          type: "candidate-pair",
          state: "succeeded",
          localCandidateId: "L",
          remoteCandidateId: "R",
          currentRoundTripTime: 0.117,
        },
      }),
    );
    expect(pares[0]?.enderecoRemoto).toBe(
      "[2603:c021:c006:a500::d83e:8bba:1765]:50006",
    );
    expect(pares[0]?.familia).toBe("IPv6");
  });

  it("NUNCA deixa o endereco local sair", () => {
    const texto = JSON.stringify(pares());
    expect(texto).not.toContain("192.168.15.9");
    expect(texto).not.toContain("54321");
    expect(pares()[0]?.familia).toBe("IPv4");
  });
});
