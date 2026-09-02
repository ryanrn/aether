"use client";

import { ConnectionQuality, RoomEvent, Track, type Room } from "livekit-client";

/**
 * Estatisticas da conexao de midia — o que o painel de "Conexao" mostra.
 *
 * De onde vem cada numero:
 *  - ping (RTT) e perda: `LocalAudioTrack.getSenderStats()`, que le o
 *    `remote-inbound-rtp` — ou seja, o que o SFU RELATA ter recebido de nos.
 *    E o RTT real da nossa midia ate o servidor.
 *  - regiao: `room.serverInfo.region` (a borda do LiveKit em que caimos).
 *  - qualidade: o proprio julgamento do LiveKit (excelente/boa/ruim), que
 *    considera mais coisas do que so o ping.
 *
 * NAO e ponta a ponta: a midia e cifrada no transporte (DTLS-SRTP) ate o SFU,
 * que a decifra para reencaminhar. Por isso o painel diz "conexao criptografada"
 * e nao "de ponta a ponta".
 */

export type ConnectionQualityLabel = "excelente" | "boa" | "ruim" | "desconhecida";

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

function rotularQualidade(q: ConnectionQuality | undefined): ConnectionQualityLabel {
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

    let rttMs: number | null = null;
    let lossPct: number | null = null;

    try {
      const faixa = room.localParticipant.getTrackPublication(
        Track.Source.Microphone,
      )?.audioTrack;
      const s = await faixa?.getSenderStats();
      if (s) {
        if (typeof s.roundTripTime === "number") {
          rttMs = Math.round(s.roundTripTime * 1000);
        }
        if (
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
      }
    } catch {
      // Sem faixa publicada (deafened, sem permissao de fala) ou stats
      // indisponiveis: mostramos so a qualidade e a regiao.
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
