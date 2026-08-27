"use client";

/**
 * Tratamento do microfone: supressao de ruido, cancelamento de eco e ganho
 * automatico.
 *
 * OS TRES JA ESTAVAM LIGADOS, sempre, sem opcao. O que muda aqui e poder
 * DESLIGAR — e isso nao e capricho: os tres processadores do navegador mexem
 * no som para favorecer fala. Quem toca um instrumento, canta, ou passa uma
 * mesa de som pelo microfone tem o proprio audio destruido por eles:
 *
 *  - a supressao de ruido corta sustentacao e reverberacao, achatando notas;
 *  - o cancelamento de eco corta o que ele julga vir do alto-falante, o que
 *    inclui a base que voce esta tocando junto;
 *  - o ganho automatico bombeia — sobe o volume nas pausas e abaixa no ataque.
 *
 * Para conversa, os tres ligados sao claramente melhores. Para audio, sao o
 * problema. Por isso a chave existe, e por isso ela vem LIGADA por padrao.
 */

export interface TratamentoDeAudio {
  supressaoDeRuido: boolean;
  cancelamentoDeEco: boolean;
  ganhoAutomatico: boolean;
  /**
   * Supressao por RNNoise, alem da nativa.
   *
   * DESLIGADA por padrao, ao contrario das outras tres. Ela carrega ~1,9 MB de
   * WASM e roda um modelo a cada 10ms — cobrar isso de quem nao pediu seria
   * gastar bateria e banda de todo mundo por um problema que nem todos tem.
   * As nativas ja resolvem o caso comum.
   */
  rnnoise: boolean;
}

export const TRATAMENTO_PADRAO: TratamentoDeAudio = {
  supressaoDeRuido: true,
  cancelamentoDeEco: true,
  ganhoAutomatico: true,
  rnnoise: false,
};

const STORAGE_KEY = "aether.tratamento-audio";

export function lerTratamentoDeAudio(): TratamentoDeAudio {
  if (typeof window === "undefined") return TRATAMENTO_PADRAO;
  try {
    const bruto = window.localStorage.getItem(STORAGE_KEY);
    if (!bruto) return TRATAMENTO_PADRAO;
    const salvo = JSON.parse(bruto) as Partial<TratamentoDeAudio>;
    /**
     * Cada campo e conferido separado, com o padrao como rede.
     * `JSON.parse` de algo editado a mao pode devolver qualquer coisa, e um
     * `undefined` chegando ao `getUserMedia` como constraint nao e o mesmo que
     * `true` — o navegador trataria como "tanto faz".
     */
    return {
      supressaoDeRuido:
        typeof salvo.supressaoDeRuido === "boolean"
          ? salvo.supressaoDeRuido
          : TRATAMENTO_PADRAO.supressaoDeRuido,
      cancelamentoDeEco:
        typeof salvo.cancelamentoDeEco === "boolean"
          ? salvo.cancelamentoDeEco
          : TRATAMENTO_PADRAO.cancelamentoDeEco,
      ganhoAutomatico:
        typeof salvo.ganhoAutomatico === "boolean"
          ? salvo.ganhoAutomatico
          : TRATAMENTO_PADRAO.ganhoAutomatico,
      rnnoise:
        typeof salvo.rnnoise === "boolean"
          ? salvo.rnnoise
          : TRATAMENTO_PADRAO.rnnoise,
    };
  } catch {
    return TRATAMENTO_PADRAO;
  }
}

export function salvarTratamentoDeAudio(valor: TratamentoDeAudio): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(valor));
  } catch {
    // Modo privado: vale so nesta sessao.
  }
}

/**
 * O formato que o `getUserMedia` (e o `audioCaptureDefaults` do LiveKit)
 * esperam.
 *
 * Funcao separada porque os nomes das constraints sao do padrao e nao nossos:
 * traduzir num lugar so evita que metade do codigo escreva `noiseSuppression`
 * e a outra metade `supressaoDeRuido`, com uma delas passando batido.
 */
export function paraConstraints(
  tratamento: TratamentoDeAudio,
): Pick<
  MediaTrackConstraints,
  "noiseSuppression" | "echoCancellation" | "autoGainControl"
> {
  return {
    noiseSuppression: tratamento.supressaoDeRuido,
    echoCancellation: tratamento.cancelamentoDeEco,
    autoGainControl: tratamento.ganhoAutomatico,
  };
}
