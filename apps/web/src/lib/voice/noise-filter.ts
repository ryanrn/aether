"use client";

import type {
  AudioProcessorOptions,
  TrackProcessor,
  Track,
} from "livekit-client";

/**
 * Supressao de ruido por RNNoise, como processador do LiveKit.
 *
 * POR QUE `setProcessor` E NAO TROCAR A FAIXA NA MAO. O SDK tem um ponto de
 * extensao para isto (`LocalAudioTrack.setProcessor`), e ele cuida do que da
 * errado quando se faz por fora: republicar na reconexao, parar a faixa antiga,
 * seguir o mudo/desmudo, trocar de microfone. Substituir a faixa publicada por
 * conta propria significa reimplementar tudo isso — e o historico de captura de
 * audio deste projeto mostra que esse trecho falha de formas que so aparecem
 * com gente numa call de verdade.
 *
 * O CAMINHO DE VOLTA E A REGRA, NAO A EXCECAO. Se o worklet nao carregar, se o
 * WASM for recusado, se o modelo falhar no meio — `processedTrack` fica sem
 * definir e o LiveKit publica o som CRU. Perder a supressao e um degrau;
 * perder a voz e uma queda, e nenhuma melhoria de audio vale calar alguem.
 */

/** Onde o bundle do worklet mora. Gerado por `npm run build:worklet`. */
const ARQUIVO_DO_WORKLET = "/rnnoise-worklet.js";

export interface FiltroDeRuido extends TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> {
  /** Liga e desliga sem refazer o grafo — o worklet so passa o som adiante. */
  definirLigado(ligado: boolean): void;
  /**
   * Forca do gate pela VAD, 0..1. `0` = RNNoise puro; `1` = agressivo (corta
   * quase tudo nas pausas). Aplica ao vivo, sem refazer o grafo.
   */
  definirForca(forca: number): void;
  /** O WASM subiu? `false` significa que o som esta passando cru. */
  estaAtivo(): boolean;
}

export function criarFiltroDeRuido(forcaInicial = 0): FiltroDeRuido {
  let contexto: AudioContext | null = null;
  /** Contexto NOSSO (48 kHz) — precisa ser fechado por nos; o do LiveKit nao. */
  let contextoProprio = false;
  let origem: MediaStreamAudioSourceNode | null = null;
  let no: AudioWorkletNode | null = null;
  let destino: MediaStreamAudioDestinationNode | null = null;
  let ativo = false;
  let ligado = true;
  let forca = Math.min(1, Math.max(0, forcaInicial));

  async function montar(opts: AudioProcessorOptions): Promise<void> {
    /**
     * Contexto PROPRIO a 48 kHz. O RNNoise so trabalha nessa taxa (quadros de
     * 480 = 10 ms a 48 k); o do LiveKit pode vir em 44,1 k, e ai o modelo
     * recebe audio "torto" e suprime pior. Se o navegador recusar a taxa
     * fixa, cai no contexto do LiveKit — pior que 48 k, melhor que sem filtro.
     */
    try {
      contexto = new AudioContext({ sampleRate: 48000 });
      contextoProprio = true;
    } catch {
      contexto = opts.audioContext;
      contextoProprio = false;
    }

    /**
     * `addModule` e idempotente por URL no mesmo contexto, mas nao entre
     * contextos — e o LiveKit pode trocar de contexto ao reiniciar. Chamar
     * sempre e barato: a segunda vez no mesmo contexto nao baixa nada.
     */
    await contexto.audioWorklet.addModule(ARQUIVO_DO_WORKLET);

    origem = contexto.createMediaStreamSource(new MediaStream([opts.track]));
    no = new AudioWorkletNode(contexto, "rnnoise-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });

    /**
     * O worklet avisa se o WASM subiu. Ate essa mensagem chegar, `ativo` e
     * falso — e o proprio worklet ja repassa o som cru nesse intervalo, entao
     * nao ha silencio esperando resposta.
     */
    no.port.onmessage = (evento) => {
      if (evento.data?.tipo === "pronto") ativo = evento.data.ok === true;
      if (evento.data?.tipo === "falhou") ativo = false;
    };
    no.port.postMessage({ tipo: "ligado", valor: ligado });
    no.port.postMessage({ tipo: "forca", valor: forca });

    destino = contexto.createMediaStreamDestination();
    origem.connect(no);
    no.connect(destino);
  }

  function desmontar(): void {
    try {
      origem?.disconnect();
      no?.disconnect();
      no?.port.close();
      // O contexto de 48 kHz e NOSSO — quem cria fecha. O do LiveKit nunca.
      if (contextoProprio) void contexto?.close();
    } catch {
      // Grafo ja derrubado com o contexto: nao ha o que soltar.
    }
    contexto = null;
    contextoProprio = false;
    origem = null;
    no = null;
    destino = null;
    ativo = false;
  }

  const filtro: FiltroDeRuido = {
    name: "rnnoise",

    async init(opts: AudioProcessorOptions) {
      try {
        await montar(opts);
        filtro.processedTrack = destino?.stream.getAudioTracks()[0];
      } catch (erro) {
        /**
         * Silencioso para quem usa, alto para quem investiga: sem
         * `processedTrack`, o LiveKit publica a faixa original e a call
         * acontece normalmente — so sem supressao.
         */
        console.error("[ruido] nao consegui montar o filtro:", erro);
        desmontar();
        filtro.processedTrack = undefined;
      }
    },

    async restart(opts: AudioProcessorOptions) {
      desmontar();
      await filtro.init(opts);
    },

    async destroy() {
      desmontar();
      filtro.processedTrack = undefined;
      // O `AudioContext` e do LiveKit: quem cria fecha, e nao nos.
    },

    definirLigado(valor: boolean) {
      ligado = valor;
      no?.port.postMessage({ tipo: "ligado", valor });
    },

    definirForca(valor: number) {
      forca = Math.min(1, Math.max(0, valor));
      no?.port.postMessage({ tipo: "forca", valor: forca });
    },

    estaAtivo() {
      return ativo;
    },
  };

  return filtro;
}
