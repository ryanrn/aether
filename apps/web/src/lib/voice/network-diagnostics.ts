"use client";

import type { Room } from "livekit-client";
import { paresDoRelatorio, rttDosPares } from "./ice-rtt";
import { relatoriosDaSessao, rttDeSinalizacao } from "./pc-access";

/**
 * Camada de diagnostico: as QUATRO latencias da chamada, lado a lado.
 *
 * POR QUE EXISTE: "ping" nao e uma coisa so. Numa chamada por WebRTC ha pelo
 * menos quatro round-trips diferentes, medidos por caminhos diferentes, e
 * confundir um com o outro e como a duvida deste painel comecou. Sao:
 *
 *  1. SINAL (LiveKit)  — ping/pong do WebSocket de sinalizacao. TCP/TLS, so
 *     comandos de sala. NAO passa audio por aqui.
 *  2. ICE (candidate-pair) — `currentRoundTripTime` das checagens STUN ate o
 *     no de midia. E o caminho por onde a VOZ realmente anda, e e ESTE o
 *     numero que o painel de Conexao mostra como "ping".
 *  3. RTP/RTCP — `remote-inbound-rtp.roundTripTime`, derivado dos relatorios
 *     RTCP do stream de audio. Mede o mesmo caminho do ICE, mas com amostragem
 *     esparsa; para audio vem sistematicamente INFLADO. Ja foi a fonte do
 *     painel e foi trocado justamente por isso (commit 9a93fa9).
 *  4. GATEWAY — ida e volta do nosso Socket.IO ate o gateway no Fly. Nada a
 *     ver com a midia: outro servidor, outro protocolo, outra rota.
 *
 * NAO fica ligada em producao. Ativa so com, no console do navegador:
 *
 *     localStorage.setItem("aether:netdebug", "1")   // e recarregar
 *     localStorage.removeItem("aether:netdebug")     // desligar
 *
 * Some sozinha quando a chamada acaba. Nao escreve nada em estado, nao muda
 * nenhum numero da interface e nao toca no caminho da midia — so le e imprime.
 */

/** Uma leitura simultanea das quatro latencias. */
export interface AmostraDeRede {
  n: number;
  /** ping/pong do WebSocket de sinalizacao do LiveKit */
  sinalMs: number | null;
  /** candidate-pair ICE — E O QUE A INTERFACE MOSTRA */
  iceMs: number | null;
  /** RTT derivado do RTCP do audio */
  rtpMs: number | null;
  /** ida e volta ate o nosso gateway Socket.IO */
  gatewayMs: number | null;
  /** ex.: "prflx/udp -> host" */
  caminho: string | null;
}

const INTERVALO_MS = 2000;
/** Depois de tantas amostras, imprime o resumo comparativo. */
const AMOSTRAS_DO_RESUMO = 20;

export function diagnosticoDeRedeLigado(): boolean {
  try {
    return localStorage.getItem("aether:netdebug") === "1";
  } catch {
    // Modo privado / armazenamento bloqueado: simplesmente nao liga.
    return false;
  }
}

/**
 * Mede o ida-e-volta ate o gateway com o ack do Socket.IO.
 *
 * O evento `ping` ja existia no gateway (`apps/realtime/src/index.ts`) e nunca
 * era chamado por ninguem. Agora ele serve para exatamente uma coisa: provar
 * que a latencia do NOSSO servidor e um numero diferente do ping da voz.
 */
type EmissorDePing = (
  aoResponder: (ida: number | null) => void,
) => void;

export function iniciarDiagnosticoDeRede(
  room: Room,
  medirGateway: EmissorDePing | null,
): () => void {
  let parado = false;
  let n = 0;
  const amostras: AmostraDeRede[] = [];
  let gatewayMs: number | null = null;

  async function tick(): Promise<void> {
    if (parado) return;

    let iceMs: number | null = null;
    let rtpMs: number | null = null;
    let caminho: string | null = null;

    for (const { nome, report } of await relatoriosDaSessao(room)) {
      if (nome !== "publisher") continue;
      const pares = paresDoRelatorio(report);
      iceMs = rttDosPares(pares);
      const ativo =
        pares
          .filter((p) => (p.bytesEnviados ?? 0) > 0)
          .sort((a, b) => (b.bytesEnviados ?? 0) - (a.bytesEnviados ?? 0))[0] ??
        pares.find((p) => p.selecionado);
      if (ativo) {
        caminho = `${ativo.tipoLocal ?? "?"}/${ativo.protocolo ?? "?"} -> ${ativo.tipoRemoto ?? "?"}`;
      }
      report.forEach((s) => {
        if (s.type !== "remote-inbound-rtp") return;
        const r = s as RTCStats & { kind?: string; roundTripTime?: number };
        if (r.kind !== "audio" || typeof r.roundTripTime !== "number") return;
        rtpMs = Math.round(r.roundTripTime * 1000);
      });
    }

    if (parado) return;

    const amostra: AmostraDeRede = {
      n: ++n,
      sinalMs: rttDeSinalizacao(room),
      iceMs,
      rtpMs,
      gatewayMs,
      caminho,
    };
    amostras.push(amostra);
    imprimir(amostra);

    if (amostras.length === AMOSTRAS_DO_RESUMO) imprimirResumo(amostras);

    // Dispara a proxima medicao de gateway para a amostra SEGUINTE — assim
    // nenhuma amostra fica esperando a rede responder.
    medirGateway?.((ida) => {
      gatewayMs = ida;
    });
  }

  const timer = setInterval(() => void tick(), INTERVALO_MS);
  void tick();

  return () => {
    parado = true;
    clearInterval(timer);
  };
}

function ms(v: number | null): string {
  return v == null ? "N/A" : `${v} ms`;
}

function imprimir(a: AmostraDeRede): void {
  console.log(
    `[AETHER NETWORK] #${a.n}\n` +
      `  Signal RTT (LiveKit WS) : ${ms(a.sinalMs)}\n` +
      `  ICE RTT (candidate-pair): ${ms(a.iceMs)}   <-- E ESTE que a interface mostra\n` +
      `  RTP RTT (RTCP do audio) : ${ms(a.rtpMs)}\n` +
      `  Gateway RTT (Socket.IO) : ${ms(a.gatewayMs)}\n` +
      `  Caminho da midia        : ${a.caminho ?? "N/A"}`,
  );
}

/** Minimo / mediana / maximo de uma coluna, ignorando os `null`. */
function faixa(valores: (number | null)[]): string {
  const v = valores.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (v.length === 0) return "N/A";
  const mediana = v[Math.floor(v.length / 2)]!;
  return `min ${v[0]} · mediana ${mediana} · max ${v[v.length - 1]} ms (${v.length} amostras)`;
}

function imprimirResumo(amostras: AmostraDeRede[]): void {
  console.log(
    `[AETHER NETWORK] RESUMO de ${amostras.length} amostras\n` +
      `  Signal RTT (LiveKit WS) : ${faixa(amostras.map((a) => a.sinalMs))}\n` +
      `  ICE RTT (candidate-pair): ${faixa(amostras.map((a) => a.iceMs))}\n` +
      `  RTP RTT (RTCP do audio) : ${faixa(amostras.map((a) => a.rtpMs))}\n` +
      `  Gateway RTT (Socket.IO) : ${faixa(amostras.map((a) => a.gatewayMs))}\n` +
      `  Caminhos vistos         : ${[...new Set(amostras.map((a) => a.caminho ?? "N/A"))].join(", ")}\n` +
      `  Como ler: o ICE e o ping da voz. Se ele estiver alto e os outros\n` +
      `  baixos, o problema esta na ROTA DA MIDIA, nao na medicao.`,
  );
}
