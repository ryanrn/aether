"use client";

import type { Room } from "livekit-client";
import { paresDoRelatorio, type ParDeCandidatos } from "./ice-rtt";
import { relatoriosDaSessao, type NomeDaConexao } from "./pc-access";

/**
 * Estatisticas completas da midia — o que o painel de Depuracao mostra.
 *
 * Separado do `connection-stats.ts` de proposito: aquele roda sempre que o
 * painel de Conexao esta aberto e so precisa de ping/perda/regiao. Este e
 * caro (le o relatorio inteiro das duas conexoes a cada segundo) e so roda
 * enquanto a janela de Depuracao esta aberta.
 *
 * TUDO AQUI VEM DE `RTCPeerConnection.getStats()`. Nao ha campo inventado nem
 * estimado: o que o WebRTC nao expoe simplesmente nao aparece. Se um numero
 * some, e porque o navegador parou de reportar — nao porque nos escondemos.
 */

/** Um ponto de uma serie temporal para os graficos. */
export interface Amostra {
  t: number;
  v: number | null;
}

export interface DebugTransporte {
  conexao: NomeDaConexao;
  estadoIce?: string;
  estadoDtls?: string;
  /** ex.: "srflx/udp -> host" — o caminho, sem endereco nenhum */
  caminho: string | null;
  /** o caminho passa por um TURN? */
  relay: boolean;
  pingMs: number | null;
  bitrateSaidaDisponivelKbps: number | null;
  pacotesEnviados: number | null;
  pacotesRecebidos: number | null;
  bytesEnviados: number | null;
  bytesRecebidos: number | null;
  /**
   * TODOS os pares de candidatos desta conexao, nao so o vencedor.
   *
   * O painel mostrava apenas o par ativo, e era justamente a comparacao entre
   * os pares que respondia "por que o ping deu esse numero": um caminho de
   * 6ms e outro de 119ms podem existir ao mesmo tempo para o MESMO servidor,
   * e ver os dois lado a lado e o que distingue caminho ruim de amostra ruim.
   */
  pares: ParDeCandidatos[];
  /** o `id` do par que carrega a midia — o que definiu o `pingMs` acima */
  paresAtivoId?: string;
}

export interface DebugAudioSaida {
  ssrc: number | null;
  /** ex.: "opus · 48000 Hz · 2 canais" */
  codec: string | null;
  /** medido pelo delta de `bytesSent` entre duas amostras */
  bitrateKbps: number | null;
  bitrateAlvoKbps: number | null;
  /** 0..1, do `media-source` — e o que faz o medidor de voz mexer */
  nivel: number | null;
  bytesEnviados: number | null;
  pacotesEnviados: number | null;
  /** relatado pelo SFU (`remote-inbound-rtp`) */
  pacotesPerdidos: number | null;
  jitterMs: number | null;
  /** o RTT do RTCP do audio — NAO e o ping da rede, esta aqui para comparar */
  rttRtcpMs: number | null;
}

export interface MediaDebug {
  regiao: string | null;
  /** identificacao do no do SFU, quando o servidor informa */
  servidor: string | null;
  transportes: DebugTransporte[];
  saida: DebugAudioSaida | null;
  historico: {
    ping: Amostra[];
    bitrate: Amostra[];
    nivel: Amostra[];
  };
}

const INTERVALO_MS = 1000;
/** ~4 min de grafico a 1 amostra por segundo. */
const MAX_AMOSTRAS = 240;

function kbps(bytesDelta: number, msDelta: number): number | null {
  if (msDelta <= 0) return null;
  return Math.round(((bytesDelta * 8) / msDelta) * 1); // bytes/ms -> kbit/s
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Uma entrada qualquer do relatorio, com os campos abertos para leitura. */
type Estatistica = RTCStats & Record<string, unknown>;

/**
 * A primeira entrada que casa com o filtro.
 *
 * Existe por causa do `forEach` do `RTCStatsReport`: atribuir dentro do
 * callback faz o TypeScript estreitar a variavel para `never` na leitura
 * seguinte. Isolar aqui, com o `as` no retorno, resolve sem espalhar cast pelo
 * codigo de leitura.
 */
function acharStat(
  report: RTCStatsReport,
  filtro: (s: Estatistica) => boolean,
): Estatistica | null {
  let achado: Estatistica | null = null;
  report.forEach((s) => {
    if (achado) return;
    const r = s as Estatistica;
    if (filtro(r)) achado = r;
  });
  return achado as Estatistica | null;
}

export function startMediaDebug(
  room: Room,
  onUpdate: (debug: MediaDebug) => void,
): () => void {
  let parado = false;
  const ping: Amostra[] = [];
  const bitrate: Amostra[] = [];
  const nivel: Amostra[] = [];
  /** Ultima leitura de bytes enviados, para derivar o bitrate. */
  let anterior: { t: number; bytes: number } | null = null;

  function empilhar(serie: Amostra[], v: number | null) {
    serie.push({ t: Date.now(), v });
    while (serie.length > MAX_AMOSTRAS) serie.shift();
  }

  async function tick(): Promise<void> {
    if (parado) return;

    const relatorios = await relatoriosDaSessao(room);
    const transportes: DebugTransporte[] = [];
    let saida: DebugAudioSaida | null = null;

    for (const { nome, report } of relatorios) {
      const pares = paresDoRelatorio(report);
      /**
       * O par que interessa e o que CARREGA A MIDIA — mesmo criterio do ping
       * (ver `ice-rtt.ts`). Seguir o "selecionado" do ICE mostra o caminho
       * errado em maquina com placa de rede virtual.
       */
      const ativo =
        pares
          .filter((p) => (p.bytesEnviados ?? 0) > 0)
          .sort((a, b) => (b.bytesEnviados ?? 0) - (a.bytesEnviados ?? 0))[0] ??
        pares.find((p) => p.selecionado) ??
        null;

      let estadoIce: string | undefined;
      let estadoDtls: string | undefined;
      let bitrateDisponivel: number | null = null;

      report.forEach((s) => {
        if (s.type === "transport") {
          const t = s as RTCTransportStats & { iceState?: string };
          estadoIce = t.iceState;
          estadoDtls = t.dtlsState;
        }
        if (
          s.type === "candidate-pair" &&
          (s as { id?: string }).id === ativo?.id
        ) {
          bitrateDisponivel = num(
            (s as { availableOutgoingBitrate?: number })
              .availableOutgoingBitrate,
          );
        }
      });

      transportes.push({
        conexao: nome,
        estadoIce,
        estadoDtls,
        caminho: ativo
          ? `${ativo.tipoLocal ?? "?"}/${ativo.protocolo ?? "?"} → ${ativo.tipoRemoto ?? "?"}`
          : null,
        relay: ativo?.tipoLocal === "relay" || ativo?.tipoRemoto === "relay",
        pares,
        paresAtivoId: ativo?.id,
        pingMs: ativo?.rttMs ?? null,
        bitrateSaidaDisponivelKbps:
          bitrateDisponivel !== null
            ? Math.round(bitrateDisponivel / 1000)
            : null,
        pacotesEnviados: null,
        pacotesRecebidos: null,
        bytesEnviados: ativo?.bytesEnviados ?? null,
        bytesRecebidos: ativo?.bytesRecebidos ?? null,
      });

      // Pacotes vem do proprio par ativo, quando o navegador reporta.
      report.forEach((s) => {
        if (s.type !== "candidate-pair") return;
        if ((s as { id?: string }).id !== ativo?.id) return;
        const p = s as { packetsSent?: number; packetsReceived?: number };
        const alvo = transportes[transportes.length - 1]!;
        alvo.pacotesEnviados = num(p.packetsSent);
        alvo.pacotesRecebidos = num(p.packetsReceived);
      });

      // O audio de SAIDA vive na conexao do publisher.
      if (nome !== "publisher") continue;

      const codecs = new Map<string, Estatistica>();
      report.forEach((s) => {
        if (s.type === "codec") codecs.set(s.id, s as Estatistica);
      });

      const o = acharStat(
        report,
        (r) => r.type === "outbound-rtp" && r.kind === "audio",
      );
      const remoto = acharStat(
        report,
        (r) => r.type === "remote-inbound-rtp" && r.kind === "audio",
      );
      const fonte = acharStat(
        report,
        (r) => r.type === "media-source" && r.kind === "audio",
      );

      if (o) {
        const bytes = num(o.bytesSent);
        const agora = Date.now();
        let taxa: number | null = null;
        if (bytes !== null && anterior) {
          taxa = kbps(bytes - anterior.bytes, agora - anterior.t);
        }
        if (bytes !== null) anterior = { t: agora, bytes };

        const codec = codecs.get(String(o.codecId ?? ""));
        const mime = codec ? String(codec.mimeType ?? "") : "";
        const canais = num(codec?.channels);
        const clock = num(codec?.clockRate);

        saida = {
          ssrc: num(o.ssrc),
          codec: mime
            ? [
                mime.replace(/^audio\//, ""),
                clock ? `${clock} Hz` : null,
                canais ? `${canais} canal(is)` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : null,
          bitrateKbps: taxa,
          bitrateAlvoKbps:
            num(o.targetBitrate) !== null
              ? Math.round(num(o.targetBitrate)! / 1000)
              : null,
          nivel: num(fonte?.audioLevel),
          bytesEnviados: bytes,
          pacotesEnviados: num(o.packetsSent),
          pacotesPerdidos: num(remoto?.packetsLost),
          jitterMs:
            num(remoto?.jitter) !== null
              ? Math.round(num(remoto!.jitter)! * 1000)
              : null,
          rttRtcpMs:
            num(remoto?.roundTripTime) !== null
              ? Math.round(num(remoto!.roundTripTime)! * 1000)
              : null,
        };
      }
    }

    const pingAtual =
      transportes
        .map((t) => t.pingMs)
        .filter((v): v is number => v !== null)[0] ?? null;
    empilhar(ping, pingAtual);
    empilhar(bitrate, saida?.bitrateKbps ?? null);
    empilhar(
      nivel,
      saida?.nivel != null ? Math.round(saida.nivel * 100) : null,
    );

    onUpdate({
      regiao: room.serverInfo?.region ?? null,
      servidor: room.serverInfo?.nodeId ?? null,
      transportes,
      saida,
      historico: {
        ping: [...ping],
        bitrate: [...bitrate],
        nivel: [...nivel],
      },
    });
  }

  const timer = setInterval(() => void tick(), INTERVALO_MS);
  void tick();

  return () => {
    parado = true;
    clearInterval(timer);
  };
}
