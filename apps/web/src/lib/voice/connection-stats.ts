"use client";

import { ConnectionQuality, RoomEvent, Track, type Room } from "livekit-client";
import { rttDoRelatorio } from "./ice-rtt";

/**
 * Estatisticas da conexao de midia — o que o painel de "Conexao" mostra.
 *
 * De onde vem cada numero:
 *  - ping (RTT): o `currentRoundTripTime` do PAR DE CANDIDATOS ICE ativo, lido
 *    da `RTCPeerConnection` da sessao (`room.engine.pcManager`). E o round-trip
 *    das checagens STUN ate o SFU — a latencia REAL da rede, a mesma medicao
 *    que outros apps de voz mostram como "ping" e que o proprio livekit-client
 *    usa internamente. Atualiza a cada checagem de consentimento STUN (~5s).
 *  - perda: `LocalAudioTrack.getSenderStats()` (`remote-inbound-rtp`) — perda
 *    de pacotes do stream de audio, que e onde ela pesa.
 *  - regiao: `room.serverInfo.region` (a borda do LiveKit em que caimos).
 *  - qualidade: o proprio julgamento do LiveKit (excelente/boa/ruim).
 *
 * POR QUE O RTT NAO VEM MAIS DE `getSenderStats().roundTripTime`: aquele e o
 * RTT derivado do RTCP do stream de audio. Para audio ele e amostrado de forma
 * esparsa e vinha SISTEMATICAMENTE INFLADO — ~117 ms num caminho cuja latencia
 * de rede real era ~4 ms (medido contra o mesmo PoP de Sao Paulo pelo Discord,
 * na mesma maquina, no mesmo instante). Nao era cache nem valor fixo: era a
 * metrica errada para "ping de rede".
 *
 * NAO e ponta a ponta: a midia e cifrada no transporte (DTLS-SRTP) ate o SFU,
 * que a decifra para reencaminhar. Por isso o painel diz "conexao criptografada"
 * e nao "de ponta a ponta".
 */

export type ConnectionQualityLabel =
  "excelente" | "boa" | "ruim" | "desconhecida";

export interface ConnectionSample {
  /** Date.now() da amostra */
  t: number;
  rttMs: number | null;
  lossPct: number | null;
}

export interface ConnectionStats {
  region: string | null;
  quality: ConnectionQualityLabel;
  /** ping da ultima amostra */
  rttMs: number | null;
  /** media dos pings do historico */
  rttMediaMs: number | null;
  /** perda de pacotes ENVIADOS na ultima janela */
  lossPct: number | null;
  history: ConnectionSample[];
}

/** ~2 min de historico, amostrado a cada 2s */
const AMOSTRA_MS = 2000;
const MAX_AMOSTRAS = 60;

function rotularQualidade(
  q: ConnectionQuality | undefined,
): ConnectionQualityLabel {
  switch (q) {
    case ConnectionQuality.Excellent:
      return "excelente";
    case ConnectionQuality.Good:
      return "boa";
    case ConnectionQuality.Poor:
    case ConnectionQuality.Lost:
      return "ruim";
    default:
      return "desconhecida";
  }
}

export function startConnectionStats(
  room: Room,
  onUpdate: (stats: ConnectionStats) => void,
): () => void {
  const history: ConnectionSample[] = [];
  let anterior: { lost: number; sent: number } | null = null;
  let parado = false;

  async function tick(): Promise<void> {
    if (parado) return;

    // RTT: o round-trip real da rede ate o SFU, do par de candidatos ICE ativo.
    const rttMs = await rttDaConexao(room);

    // Perda: do stream de audio, onde ela importa.
    let lossPct: number | null = null;
    try {
      const faixa = room.localParticipant.getTrackPublication(
        Track.Source.Microphone,
      )?.audioTrack;
      const s = await faixa?.getSenderStats();
      if (
        s &&
        typeof s.packetsLost === "number" &&
        typeof s.packetsSent === "number"
      ) {
        if (anterior) {
          const dLost = Math.max(0, s.packetsLost - anterior.lost);
          const dSent = Math.max(0, s.packetsSent - anterior.sent);
          const total = dLost + dSent;
          if (total > 0) lossPct = (dLost / total) * 100;
        }
        anterior = { lost: s.packetsLost, sent: s.packetsSent };
      }
    } catch {
      // Sem faixa publicada (deafened, mudo pelo servidor, sem SPEAK): o RTT e
      // a regiao ainda aparecem; so a perda fica indisponivel.
    }

    history.push({ t: Date.now(), rttMs, lossPct });
    while (history.length > MAX_AMOSTRAS) history.shift();

    const pings = history
      .map((h) => h.rttMs)
      .filter((v): v is number => v !== null);
    const rttMediaMs =
      pings.length > 0
        ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length)
        : null;

    onUpdate({
      region: room.serverInfo?.region ?? null,
      quality: rotularQualidade(room.localParticipant.connectionQuality),
      rttMs,
      rttMediaMs,
      lossPct,
      history: [...history],
    });
  }

  const timer = setInterval(() => void tick(), AMOSTRA_MS);
  void tick();

  const aoMudarQualidade = () => void tick();
  room.on(RoomEvent.ConnectionQualityChanged, aoMudarQualidade);

  return () => {
    parado = true;
    clearInterval(timer);
    room.off(RoomEvent.ConnectionQualityChanged, aoMudarQualidade);
  };
}

/** O minimo do `PCTransport` do livekit-client que precisamos tocar. */
interface PCTransportLike {
  getStats: () => Promise<RTCStatsReport | undefined>;
}

/**
 * As `RTCPeerConnection`s da sessao, via o `pcManager` interno do
 * livekit-client. NAO e API publica — por isso o acesso e por cast e
 * defensivo: se a forma mudar numa atualizacao da lib, devolvemos `[]`, o
 * ping vira `null` e o painel mostra "—" em vez de quebrar.
 *
 * Ordem: `publisher` primeiro (o caminho ativo quando o mic esta publicado),
 * `subscriber` depois. Os dois falam com o MESMO PoP, entao o RTT bate.
 */
function pcTransports(room: Room): PCTransportLike[] {
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
    avisarSemPcManager();
    return [];
  }
  return [manager.publisher, manager.subscriber].filter(
    (pc): pc is PCTransportLike => typeof pc?.getStats === "function",
  );
}

async function rttDaConexao(room: Room): Promise<number | null> {
  for (const pc of pcTransports(room)) {
    let relatorio: RTCStatsReport | undefined;
    try {
      relatorio = await pc.getStats();
    } catch {
      continue;
    }
    const rtt = relatorio ? rttDoRelatorio(relatorio) : null;
    if (rtt !== null) return rtt;
  }
  return null;
}

let avisou = false;
function avisarSemPcManager(): void {
  if (avisou) return;
  avisou = true;
  console.warn(
    "[voz] sem acesso ao pcManager do livekit-client para medir o ping — " +
      "a forma interna da lib mudou? O painel de Conexao vai mostrar '—'.",
  );
}
