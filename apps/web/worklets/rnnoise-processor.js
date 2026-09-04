import createRNNWasmModuleSync from "@jitsi/rnnoise-wasm/dist/rnnoise-sync.js";

/**
 * Supressao de ruido por RNNoise, DENTRO da thread de audio.
 *
 * POR QUE AQUI E NAO NA THREAD PRINCIPAL. A alternativa seria o worklet mandar
 * cada quadro para a pagina, ela processar e devolver. Isso amarra o audio ao
 * event loop do React: qualquer render longo vira falha no som — e a defesa
 * contra isso seria um buffer grande, que e latencia permanente cobrada de
 * todo mundo para se proteger de um travamento ocasional. Rodando aqui, o
 * processamento acontece no mesmo tick do audio e nao ha ida e volta.
 *
 * O ARQUIVO E MONTADO POR ESBUILD (`scripts/build-rnnoise-worklet.mjs`), que
 * embute o modulo WASM inteiro neste bundle. `audioWorklet.addModule` carrega
 * script CLASSICO e o escopo do worklet nao tem `import`, `fetch` nem
 * `import.meta` — importar em tempo de execucao, como o pacote original faz,
 * simplesmente nao funciona la dentro.
 */

/** RNNoise so trabalha nisto: 480 amostras (10ms a 48kHz). */
const QUADRO = 480;

/**
 * ESCALA DE 16 BITS. O RNNoise assume PCM de 16 bits, e o WebAudio entrega
 * float de -1 a 1. Passar o float cru faz o modelo ver um sinal ~32000 vezes
 * mais fraco que o esperado: ele classifica tudo como silencio e devolve
 * silencio — o audio "funciona" e some, que e o modo de falha mais confuso
 * possivel porque nao ha erro nenhum.
 */
const ESCALA = 32768;

/**
 * O RNNoise sozinho preserva fala e corta ruido ESTACIONARIO (ventilador,
 * chiado). Barulho impulsivo — clique de teclado, estalo — e o ponto fraco
 * dele. O que ajuda de verdade e a probabilidade de voz que ele ja calcula a
 * cada quadro (`_rnnoise_process_frame` devolve 0..1): quando ela esta baixa,
 * quase nada de fala esta acontecendo, e abaixar o ganho ai mata o teclado
 * das PAUSAS — que e a maior parte do que incomoda.
 *
 *  - `ATAQUE` curto para nao comer o inicio de palavra;
 *  - `SEGURA` mantem aberto um tempo depois da fala parar, para nao cortar
 *    respiro e final de frase;
 *  - `SOLTA` mais lento, para o gate fechar sem "bombear".
 */
const VAD_LIMIAR = 0.5;
const ATAQUE_S = 0.005;
const SOLTA_S = 0.12;
const SEGURA_S = 0.15;

class RnnoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.pronto = false;
    this.ligado = true;
    /**
     * Forca do gate pela VAD, 0..1. `0` = RNNoise puro (nenhum gate); `1` =
     * agressivo (piso ~ -30 dB nas pausas). Vem da preferencia do usuario.
     */
    this.forca = 0;
    /** Envelope atual do gate e quanto ainda "segura aberto". */
    this.ganhoPorta = 1;
    this.seguraRestante = 0;

    this.attackCoef = Math.exp(-1 / (ATAQUE_S * sampleRate));
    this.releaseCoef = Math.exp(-1 / (SOLTA_S * sampleRate));
    this.seguraAmostras = Math.round(SEGURA_S * sampleRate);

    /** Acumula entrada ate fechar um quadro de 480. */
    this.entrada = new Float32Array(QUADRO);
    this.naEntrada = 0;
    /** Saida ja processada, esperando ser consumida em blocos de 128. */
    this.saida = new Float32Array(QUADRO * 4);
    this.inicioSaida = 0;
    this.fimSaida = 0;
    this.quadro = new Float32Array(QUADRO);

    this.port.onmessage = (evento) => {
      if (evento.data?.tipo === "ligado") {
        this.ligado = evento.data.valor === true;
      }
      if (evento.data?.tipo === "forca") {
        const v = Number(evento.data.valor);
        if (Number.isFinite(v)) this.forca = Math.min(1, Math.max(0, v));
      }
    };

    /**
     * A instanciacao e sincrona de proposito: o construtor do worklet nao pode
     * esperar promessa, e a versao `sync` existe justamente para isso. Falhar
     * aqui NAO pode derrubar o audio — `pronto` fica falso e o `process`
     * abaixo repassa o som cru.
     */
    try {
      this.wasm = createRNNWasmModuleSync();
      this.estado = this.wasm._rnnoise_create(0);
      this.buffer = this.wasm._malloc(QUADRO * 4);
      this.pronto = Boolean(this.estado && this.buffer);
      this.port.postMessage({ tipo: "pronto", ok: this.pronto });
    } catch (erro) {
      this.pronto = false;
      this.port.postMessage({ tipo: "pronto", ok: false, erro: String(erro) });
    }
  }

  /** Processa um quadro fechado e empurra o resultado para a saida. */
  processarQuadro() {
    const heap = this.wasm.HEAPF32;
    const base = this.buffer >> 2;

    for (let i = 0; i < QUADRO; i++) {
      heap[base + i] = this.quadro[i] * ESCALA;
    }

    // O retorno e a probabilidade de voz do quadro (0..1) — antes era jogado
    // fora.
    const vad = this.wasm._rnnoise_process_frame(
      this.estado,
      this.buffer,
      this.buffer,
    );

    /**
     * Alvo do gate: fala (ou dentro do tempo de "segura") => ganho cheio;
     * pausa => piso. `forca` 0 zera o gate (piso = 1), reproduzindo o
     * comportamento antigo exatamente.
     */
    const piso = 1 - this.forca * 0.97;
    const falando = vad >= VAD_LIMIAR;
    if (falando) this.seguraRestante = this.seguraAmostras;
    const alvo = falando || this.seguraRestante > 0 ? 1 : piso;

    for (let i = 0; i < QUADRO; i++) {
      const coef = alvo > this.ganhoPorta ? this.attackCoef : this.releaseCoef;
      this.ganhoPorta = alvo + (this.ganhoPorta - alvo) * coef;
      if (this.seguraRestante > 0) this.seguraRestante--;
      this.saida[this.fimSaida % this.saida.length] =
        (heap[base + i] / ESCALA) * this.ganhoPorta;
      this.fimSaida++;
    }
  }

  process(inputs, outputs) {
    const entrada = inputs[0]?.[0];
    const saida = outputs[0]?.[0];
    if (!saida) return true;

    /**
     * Sem entrada (microfone mudo ou aparelho trocando), ou com o filtro
     * desligado, ou se o WASM nao carregou: o som CRU passa direto. Perder a
     * supressao e um degrau; perder a voz e uma queda.
     */
    if (!entrada || !this.ligado || !this.pronto) {
      if (entrada) saida.set(entrada);
      else saida.fill(0);
      return true;
    }

    for (let i = 0; i < entrada.length; i++) {
      this.entrada[this.naEntrada++] = entrada[i];
      if (this.naEntrada === QUADRO) {
        this.quadro.set(this.entrada);
        this.naEntrada = 0;
        try {
          this.processarQuadro();
        } catch {
          // Uma falha no meio nao pode calar o resto da call: desliga o
          // processamento e segue com o som cru daqui para a frente.
          this.pronto = false;
          this.port.postMessage({ tipo: "falhou" });
        }
      }
    }

    const disponivel = this.fimSaida - this.inicioSaida;
    if (disponivel >= saida.length) {
      for (let i = 0; i < saida.length; i++) {
        saida[i] = this.saida[this.inicioSaida % this.saida.length];
        this.inicioSaida++;
      }
    } else {
      /**
       * Ainda enchendo o primeiro quadro: silencio por 10ms, uma unica vez no
       * inicio. Repetir amostra antiga aqui produziria um estalo.
       */
      saida.fill(0);
    }

    return true;
  }
}

registerProcessor("rnnoise-processor", RnnoiseProcessor);
