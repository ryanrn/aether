"use client";

import type { Room } from "livekit-client";

/**
 * Acesso as `RTCPeerConnection` da sessao do LiveKit.
 *
 * NAO e API publica do livekit-client: `room.engine.pcManager` e interno. O
 * acesso e por cast e defensivo de proposito — se a forma mudar numa
 * atualizacao da lib, devolvemos `[]` e quem chama mostra "—" em vez de
 * quebrar a chamada.
 *
 * Mora em modulo proprio porque DOIS lugares precisam: o painel de Conexao
 * (ping/perda) e o de Depuracao (estatisticas completas). Duas copias do mesmo
 * cast desviariam na primeira atualizacao do LiveKit.
 */

export type NomeDaConexao = "publisher" | "subscriber";

/** O minimo do `PCTransport` do livekit-client que precisamos tocar. */
export interface PCTransportLike {
  getStats: () => Promise<RTCStatsReport | undefined>;
}

export interface ConexaoDaSessao {
  nome: NomeDaConexao;
  pc: PCTransportLike;
}

let avisou = false;

export function conexoesDaSessao(room: Room): ConexaoDaSessao[] {
  const manager = (
    room as unknown as {
      engine?: {
        pcManager?: {
          publisher?: PCTransportLike;
          subscriber?: PCTransportLike;
        };
      };
    }
  ).engine?.pcManager;

  if (!manager) {
    if (!avisou) {
      avisou = true;
      console.warn(
        "[voz] sem acesso ao pcManager do livekit-client — a forma interna da " +
          "lib mudou? Ping e depuracao vao aparecer vazios.",
      );
    }
    return [];
  }

  return (
    [
      { nome: "publisher" as const, pc: manager.publisher },
      { nome: "subscriber" as const, pc: manager.subscriber },
    ] satisfies { nome: NomeDaConexao; pc?: PCTransportLike }[]
  ).filter((c): c is ConexaoDaSessao => typeof c.pc?.getStats === "function");
}

/** `getStats()` de cada conexao, ignorando as que falharem. */
export async function relatoriosDaSessao(
  room: Room,
): Promise<{ nome: NomeDaConexao; report: RTCStatsReport }[]> {
  const saida: { nome: NomeDaConexao; report: RTCStatsReport }[] = [];
  for (const { nome, pc } of conexoesDaSessao(room)) {
    try {
      const report = await pc.getStats();
      if (report) saida.push({ nome, report });
    } catch {
      // Conexao ja fechada entre o listar e o consultar: so pular.
    }
  }
  return saida;
}

/**
 * RTT da SINALIZACAO do LiveKit (o ping/pong do WebSocket de sinal).
 *
 * `SignalClient.rtt` — tambem interno, mesmo cuidado do `pcManager`.
 *
 * NAO e o ping da chamada e nunca alimentou o painel: a sinalizacao e um
 * WebSocket (TCP/TLS) que so troca comandos de sala, enquanto a voz corre por
 * UDP direto ao no de midia. Existe aqui APENAS para a camada de diagnostico
 * poder mostrar os dois lado a lado e provar que sao numeros diferentes.
 */
export function rttDeSinalizacao(room: Room): number | null {
  const rtt = (
    room as unknown as { engine?: { client?: { rtt?: number } } }
  ).engine?.client?.rtt;
  return typeof rtt === "number" && rtt > 0 ? Math.round(rtt) : null;
}
