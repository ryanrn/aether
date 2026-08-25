/**
 * Transforma o PCM que vem do app de desktop numa faixa de audio tocavel.
 *
 * Roda na thread de AUDIO, e isso e o ponto: o `process()` abaixo e chamado a
 * cada 128 quadros (2,7 ms em 48 kHz) por um relogio de tempo real. Se ele
 * atrasar, o som falha — por isso aqui dentro nao ha alocacao, nao ha `await`
 * e nao ha nada que possa demorar.
 *
 * POR QUE UM RING BUFFER, e nao agendar cada pedaco com `start(quando)`: o
 * agendamento por duracao estimada acumula deriva. O relogio da placa de som
 * e o do `AudioContext` nunca sao exatamente iguais, e a diferenca vira
 * estalo e dessincronia em minutos de chamada. O ring buffer deixa o proprio
 * relogio do audio puxar os dados no ritmo dele.
 */

/** Meio segundo em 48 kHz estereo. Folga para o soluco da ponte IPC. */
const CAPACIDADE = 48000 / 2;

class LoopbackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Dois canais separados; o buffer que chega e intercalado.
    this.esquerda = new Float32Array(CAPACIDADE);
    this.direita = new Float32Array(CAPACIDADE);
    this.escrita = 0;
    this.leitura = 0;
    this.disponivel = 0;

    /** Quantos quadros faltaram — o lado de fora usa para diagnostico. */
    this.faltas = 0;
    this.descartes = 0;
    this.ultimoAviso = 0;

    this.port.onmessage = (evento) => {
      const dado = evento.data;
      if (dado === "encerrar") {
        this.encerrado = true;
        return;
      }
      if (dado instanceof Float32Array) this.escrever(dado);
    };
  }

  /**
   * Escreve um bloco INTERCALADO (L,R,L,R...) no ring.
   *
   * Estourou a capacidade, descartamos o MAIS ANTIGO. Em audio ao vivo o
   * passado nao interessa: segurar o atraso e pior do que perder um pedaco.
   */
  escrever(intercalado) {
    const quadros = intercalado.length >> 1;

    if (this.disponivel + quadros > CAPACIDADE) {
      const sobra = this.disponivel + quadros - CAPACIDADE;
      this.leitura = (this.leitura + sobra) % CAPACIDADE;
      this.disponivel -= sobra;
      this.descartes += sobra;
    }

    let escrita = this.escrita;
    for (let i = 0; i < quadros; i++) {
      this.esquerda[escrita] = intercalado[i * 2];
      this.direita[escrita] = intercalado[i * 2 + 1];
      escrita = escrita + 1 === CAPACIDADE ? 0 : escrita + 1;
    }
    this.escrita = escrita;
    this.disponivel += quadros;
  }

  process(_entradas, saidas) {
    const saida = saidas[0];
    if (!saida || saida.length === 0) return !this.encerrado;

    const canalE = saida[0];
    const canalD = saida[1] ?? saida[0];
    const pedidos = canalE.length;

    /**
     * Falta de dados vira SILENCIO, nao repeticao do ultimo bloco.
     *
     * Repetir mascara o problema com um zumbido; o silencio e honesto e some
     * sozinho quando os dados voltam.
     */
    if (this.disponivel < pedidos) {
      canalE.fill(0);
      canalD.fill(0);
      this.faltas += pedidos - this.disponivel;
      this.relatar();
      return !this.encerrado;
    }

    let leitura = this.leitura;
    for (let i = 0; i < pedidos; i++) {
      canalE[i] = this.esquerda[leitura];
      canalD[i] = this.direita[leitura];
      leitura = leitura + 1 === CAPACIDADE ? 0 : leitura + 1;
    }
    this.leitura = leitura;
    this.disponivel -= pedidos;

    this.relatar();
    return !this.encerrado;
  }

  /**
   * Manda numeros para fora de vez em quando — uma vez por segundo, nunca a
   * cada bloco. `postMessage` a 375 vezes por segundo seria mais caro que o
   * proprio trabalho de audio.
   */
  relatar() {
    if (currentTime - this.ultimoAviso < 1) return;
    this.ultimoAviso = currentTime;
    this.port.postMessage({
      disponivel: this.disponivel,
      faltas: this.faltas,
      descartes: this.descartes,
    });
  }
}

registerProcessor("loopback-processor", LoopbackProcessor);
