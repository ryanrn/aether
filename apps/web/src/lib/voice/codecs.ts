"use client";

import type { VideoCodec } from "livekit-client";

/**
 * Escolha de codec para o compartilhamento de tela.
 *
 * POR QUE NAO E `setCodecPreferences`. A API crua do WebRTC manda mexer no
 * transceiver da `RTCPeerConnection` — mas quem cria e possui essa conexao
 * aqui e o LiveKit, e ele a recria a cada reconexao, renegociacao e mudanca de
 * publicacao. Uma preferencia aplicada por fora seria desfeita no primeiro
 * desses eventos, e sem aviso: a call continuaria funcionando, so que no codec
 * errado. Pior, mexer no transceiver no meio da negociacao do SDK e o tipo de
 * coisa que quebra a call inteira em vez de degradar.
 *
 * O LiveKit resolve isso na publicacao (`publishTrack({ videoCodec })`), que e
 * onde a decisao pertence — ele monta a oferta com esse codec e o mantem
 * atraves das renegociacoes.
 *
 * QUE CODECS EXISTEM aqui e decidido pelo SDK, nao por nos: `videoCodecs` do
 * `livekit-client` e a lista que ele sabe publicar. Inventar uma lista propria
 * significaria oferecer na tela algo que o SDK recusaria na hora de usar.
 */

/** `null` = deixar o LiveKit decidir. E o padrao, e o recomendado. */
export type EscolhaDeCodec = VideoCodec | null;

const STORAGE_KEY = "aether.codec-tela";

/**
 * Os codecs que a tela oferece, na ordem do menu.
 *
 * `h265` entra porque o SDK aceita, mas quase nenhum navegador ENCODA hoje —
 * e por isso que a deteccao de suporte abaixo existe: oferecer sem avisar
 * levaria a pessoa a escolher algo que falha na hora de transmitir.
 */
export const CODECS_DE_TELA = [
  { valor: null, rotulo: "Automatico", recomendado: true },
  { valor: "vp8" as const, rotulo: "VP8" },
  { valor: "h264" as const, rotulo: "H.264" },
  { valor: "vp9" as const, rotulo: "VP9" },
  { valor: "av1" as const, rotulo: "AV1" },
  { valor: "h265" as const, rotulo: "H.265 (HEVC)" },
] satisfies ReadonlyArray<{
  valor: EscolhaDeCodec;
  rotulo: string;
  recomendado?: boolean;
}>;

/**
 * Quais codecs este navegador consegue ENVIAR.
 *
 * `getCapabilities("video")` do SENDER, e nao do receiver: a pergunta e "eu
 * consigo codificar isto para mandar", nao "eu consigo decodificar o que
 * chegar". Sao listas diferentes — quase todo navegador DECODIFICA H.265 e
 * quase nenhum o CODIFICA, entao usar o receiver mostraria uma opcao que
 * falharia ao transmitir.
 *
 * Devolve `null` quando o navegador nao expoe a API: ai a tela mostra tudo,
 * porque esconder por falta de informacao seria pior do que deixar tentar.
 */
export function codecsSuportados(): Set<string> | null {
  if (typeof RTCRtpSender === "undefined") return null;
  if (typeof RTCRtpSender.getCapabilities !== "function") return null;

  const caps = RTCRtpSender.getCapabilities("video");
  if (!caps?.codecs?.length) return null;

  const nomes = new Set<string>();
  for (const codec of caps.codecs) {
    // "video/VP8" -> "vp8"; o SDK usa o nome curto em minusculas.
    const curto = codec.mimeType.split("/")[1]?.toLowerCase();
    if (curto) nomes.add(curto);
  }
  return nomes;
}

/** Este codec da para usar aqui? `null` (automatico) sempre da. */
export function codecDisponivel(
  codec: EscolhaDeCodec,
  suportados: Set<string> | null,
): boolean {
  if (codec === null) return true;
  if (suportados === null) return true;
  return suportados.has(codec);
}

export function lerCodecDeTela(): EscolhaDeCodec {
  if (typeof window === "undefined") return null;
  try {
    const bruto = window.localStorage.getItem(STORAGE_KEY);
    if (!bruto) return null;
    /**
     * Validado na LEITURA, e nao so na escrita: o valor mora no navegador da
     * pessoa e pode ter sido editado a mao, ou ter sobrado de uma versao em
     * que a lista era outra. Um codec desconhecido chegando ao
     * `publishTrack` faria a transmissao falhar por um motivo que ninguem
     * associaria a uma configuracao antiga.
     */
    const conhecido = CODECS_DE_TELA.some((c) => c.valor === bruto);
    return conhecido ? (bruto as VideoCodec) : null;
  } catch {
    return null;
  }
}

export function salvarCodecDeTela(codec: EscolhaDeCodec): void {
  if (typeof window === "undefined") return;
  try {
    if (codec) window.localStorage.setItem(STORAGE_KEY, codec);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Modo privado ou armazenamento cheio: a escolha vale so nesta sessao.
  }
}
