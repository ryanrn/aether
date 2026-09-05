"use client";

import { ConnectionQuality, RoomEvent, Track, type Room } from "livekit-client";
import { paresDoRelatorio, rttDosPares, type ParDeCandidatos } from "./ice-rtt";
import { relatoriosDaSessao, type NomeDaConexao } from "./pc-access";

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

/** O que cada `RTCPeerConnection` da sessao esta usando, para diagnostico. */
export interface RotaDaConexao {
  pc: NomeDaConexao;
  pares: ParDeCandidatos[];
  /** o RTT que ESTA rota contribuiu nesta amostra */
  rttMs: number | null;
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
  /**
   * Os pares de candidatos de cada conexao, so da ULTIMA amostra (fora do
   * historico, que ficaria enorme). Alimenta o "Copiar diagnostico" — e o que
   * permite ver POR QUE o ping deu o numero que deu, sem adivinhar.
   *
   * Nao carrega endereco nenhum: so tipo de candidato e protocolo.
   */
  rotas: RotaDaConexao[];
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
    const rotas = await rotasDaConexao(room);
    const rttMs = rttDaSessao(rotas);

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
      rotas,
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

/**
 * O ping da sessao: o da conexao de ENVIO (publisher).
 *
 * POR QUE NAO O MENOR DAS DUAS: ate aqui isto era `Math.min(publisher,
 * subscriber)`. As duas falam com o mesmo SFU, entao em regime normal os
 * numeros batem — mas quando eles divergem, pegar o menor e escolher o
 * numero mais bonito, nao medir o caminho certo. Se a conexao de envio esta
 * a 119ms, e por 119ms que a SUA VOZ sai; mostrar o 5ms da outra esconderia
 * exatamente o que a pessoa precisa ver.
 *
 * O `subscriber` so entra quando o publisher nao tem medicao — o que e um
 * caso real, nao teorico: quem entra sem permissao de falar (ou com o mic
 * mutado desde o inicio) pode nem ter conexao de publicacao. Nesses casos o
 * ping do subscriber e a unica leitura possivel, e e melhor que "—".
 */
export function rttDaSessao(rotas: RotaDaConexao[]): number | null {
  const publisher = rotas.find((r) => r.pc === "publisher");
  if (publisher?.rttMs != null) return publisher.rttMs;
  return rotas.find((r) => r.pc === "subscriber")?.rttMs ?? null;
}

/**
 * Os pares de candidatos de cada conexao, com o RTT que cada uma daria.
 *
 * O dump volta junto para o diagnostico poder mostrar QUAL rota deu qual
 * numero — quem escolhe entre elas e o `rttDaSessao` acima.
 */
async function rotasDaConexao(room: Room): Promise<RotaDaConexao[]> {
  const relatorios = await relatoriosDaSessao(room);
  return relatorios.map(({ nome, report }) => {
    const pares = paresDoRelatorio(report);
    return { pc: nome, pares, rttMs: rttDosPares(pares) };
  });
}
