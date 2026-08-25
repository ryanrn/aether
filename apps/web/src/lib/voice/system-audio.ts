"use client";

/**
 * Som do sistema pelo modulo nativo do app de desktop.
 *
 * POR QUE ESTE CAMINHO EXISTE: o Chromium nao abre a captura de som em
 * aparelhos que se anunciam com mais de dois canais. Medido num Logitech
 * PRO X2 no receptor sem fio, que se apresenta como 7.1 (8 canais) mesmo com
 * o surround desligado — `NotReadableError: Could not start audio source` em
 * `loopback`, em `loopbackWithMute` e ate com a chave
 * `--try-supported-channel-layouts`. O Windows entrega esse som sem
 * dificuldade: o Xbox Game Bar grava dele.
 *
 * O caminho aqui e outro: o processo principal captura por WASAPI usando o
 * formato do PROPRIO aparelho, mistura para estereo, e manda o PCM. Aqui ele
 * vira `MediaStreamTrack`, que o LiveKit publica como qualquer outra faixa.
 *
 * GANHO DE LADO, e nem por isso pequeno: video e som deixam de ser
 * tudo-ou-nada. Antes, `getDisplayMedia({audio:true})` falhava INTEIRO quando
 * o som nao abria — a tela ia junto. Agora a tela e capturada sozinha e o som
 * e uma faixa separada, que pode faltar sem levar o resto.
 */

interface PonteLoopback {
  disponivel: () => Promise<{ disponivel: boolean; motivo: string | null }>;
  saidas: () => Promise<Array<{ id: string; name: string; isDefault: boolean }>>;
  iniciar: (deviceId?: string) => Promise<
    | { ok: true; formato: { sampleRate: number; channels: number } }
    | { ok: false; erro: string }
  >;
  parar: () => Promise<{ ok: true }>;
  escolhaDoSeletor: () => Promise<boolean>;
  aoReceber: (callback: (pedaco: Uint8Array) => void) => () => void;
}

function ponte(): PonteLoopback | null {
  if (typeof window === "undefined") return null;
  const desktop = (window as { aetherDesktop?: { loopback?: PonteLoopback } })
    .aetherDesktop;
  return desktop?.loopback ?? null;
}

/** O app consegue capturar o som do sistema por este caminho? */
export async function podeCapturarSomDoSistema(): Promise<boolean> {
  const api = ponte();
  if (!api) return false;
  try {
    const resposta = await api.disponivel();
    return resposta.disponivel === true;
  } catch {
    return false;
  }
}

/**
 * A pessoa pediu som, do jeito que o app de desktop pergunta?
 *
 * No desktop a pergunta esta no SELETOR de tela, nao na barra de controles —
 * e por isso a resposta precisa vir de la. A preferencia do navegador
 * (`withSystemAudio`) nao vale no desktop: a caixa dela nem e exibida, entao
 * ficaria presa no que o localStorage tivesse, inclusive num `false` gravado
 * por uma falha antiga. Foi exatamente isso que impediu o caminho nativo de
 * ser usado na primeira versao.
 */
export async function pediuSomNoSeletor(): Promise<boolean> {
  const api = ponte();
  if (!api) return false;
  try {
    return (await api.escolhaDoSeletor()) === true;
  } catch {
    return true; // na duvida, tenta o som — falhar nele nao derruba a tela
  }
}

export interface SomDoSistema {
  track: MediaStreamTrack;
  parar: () => Promise<void>;
}

/**
 * Abre a captura e devolve uma faixa de audio pronta para publicar.
 *
 * Devolve `null` quando nao da — e quem chama segue sem som, com o video
 * funcionando. Nunca lanca por falha de captura: perder o som e um degrau,
 * perder a tela inteira e uma queda.
 */
export async function capturarSomDoSistema(): Promise<SomDoSistema | null> {
  const api = ponte();
  if (!api) return null;

  const inicio = await api.iniciar().catch(() => null);
  if (!inicio || !inicio.ok) return null;

  const taxa = inicio.formato.sampleRate;

  /**
   * O `AudioContext` nasce com a MESMA taxa do aparelho.
   *
   * Se as duas diferirem, o navegador reamostra por conta propria — e
   * reamostragem em cima de um fluxo que ja chega em tempo real e o caminho
   * curto para estalo. Pedindo a taxa certa, ninguem precisa converter nada.
   */
  const contexto = new AudioContext({ sampleRate: taxa });

  try {
    await contexto.audioWorklet.addModule("/loopback-worklet.js");
  } catch {
    await api.parar().catch(() => undefined);
    await contexto.close().catch(() => undefined);
    return null;
  }

  const no = new AudioWorkletNode(contexto, "loopback-processor", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  const destino = contexto.createMediaStreamDestination();
  no.connect(destino);

  /**
   * O no NAO e ligado em `contexto.destination`, de proposito: isso tocaria o
   * som do sistema de volta nos seus proprios alto-falantes, em eco de si
   * mesmo. O destino aqui e so a faixa que vai para os outros.
   */

  const cancelar = api.aoReceber((pedaco) => {
    /**
     * O IPC entrega bytes; o worklet quer amostras. A conversao e uma VISTA
     * sobre a mesma memoria, sem copiar — a 384 KB/s, copiar duas vezes por
     * pedaco seria trabalho a toa cinquenta vezes por segundo.
     */
    const bytes =
      pedaco instanceof Uint8Array ? pedaco : new Uint8Array(pedaco);
    const amostras = new Float32Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength >> 2,
    );
    // Copia UMA vez, porque o buffer do IPC pode ser reaproveitado depois.
    no.port.postMessage(new Float32Array(amostras));
  });

  const track = destino.stream.getAudioTracks()[0];
  if (!track) {
    cancelar();
    await api.parar().catch(() => undefined);
    await contexto.close().catch(() => undefined);
    return null;
  }

  let parado = false;
  return {
    track,
    parar: async () => {
      if (parado) return;
      parado = true;
      cancelar();
      no.port.postMessage("encerrar");
      no.disconnect();
      await api.parar().catch(() => undefined);
      await contexto.close().catch(() => undefined);
    },
  };
}
