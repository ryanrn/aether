/**
 * Feature flags / kill switches — o registro do que existe.
 *
 * ESTE ARQUIVO E A UNICA FONTE das chaves. `@aether/access` le e escreve a
 * linha no banco; o app web e o gateway CONSOMEM `flagLigada(chave)` nos
 * pontos de decisao; a tela da equipe lista o que esta aqui. Uma segunda lista
 * divergiria na primeira vez que alguem somasse uma chave de um lado so — e ai
 * o kill switch que deveria estar desligando o registro estaria olhando para
 * uma chave que ninguem le.
 *
 * ISOMORFICO de proposito (sem dependencia de node): entra no barrel e o
 * cliente pode importar para esconder um botao. Esconder nao e autorizacao —
 * quem barra e o servidor, relendo `flagLigada` no ponto de acao.
 *
 * O QUE E UM KILL SWITCH AQUI: uma chave cujo `padrao` e `true` (o recurso
 * funciona), que a equipe VIRA para `false` durante um incidente sem deploy.
 * Nao e para experimento A/B nem rollout gradual — e o freio de emergencia.
 */

export type ChaveDeFlag =
  | "registro_aberto"
  | "registro_exige_codigo"
  | "upload_de_imagem"
  | "voz_habilitada";

export interface DefinicaoDeFlag {
  /** Nome curto para a tela da equipe. */
  rotulo: string;
  /** Texto curto para a tela da equipe — o que muda ao desligar. */
  descricao: string;
  /**
   * O valor quando NAO ha linha no banco, e tambem o valor de fallback quando
   * a leitura falha. Ver `flagLigada`: um banco fora do ar nao pode, ele
   * proprio, desligar o registro — o padrao decide.
   */
  padrao: boolean;
}

export const FLAGS_CONHECIDAS: Record<ChaveDeFlag, DefinicaoDeFlag> = {
  registro_aberto: {
    rotulo: "Cadastro aberto",
    descricao:
      "Criação de novas contas. Desligar bloqueia toda a rota de registro no servidor.",
    padrao: true,
  },
  registro_exige_codigo: {
    rotulo: "Cadastro só por convite",
    descricao:
      "Exige um código de convite válido para criar conta. Liga o beta fechado.",
    padrao: false,
  },
  upload_de_imagem: {
    rotulo: "Envio de imagem e vídeo",
    descricao:
      "Anexos de imagem e vídeo em mensagens. Desligado no beta fechado até haver varredura de conteúdo — texto, link, PDF e áudio seguem funcionando.",
    padrao: false,
  },
  voz_habilitada: {
    rotulo: "Voz habilitada",
    descricao:
      "Entrar em canal de voz. Desligar recusa novos voice:join; quem já está na call não é derrubado.",
    padrao: true,
  },
};

/** As chaves como lista, para a tela iterar sem depender de `Object.keys`. */
export const CHAVES_DE_FLAG = Object.keys(FLAGS_CONHECIDAS) as ChaveDeFlag[];

/**
 * Uma linha da tela da equipe: a chave, o estado efetivo e a definicao.
 *
 * MORA AQUI (nao em `@aether/access`) para o componente de cliente da tela
 * poder importar o tipo sem arrastar `@aether/access` — que e server-only —
 * para o bundle. Quem PRODUZ e `lerFlagsParaAdmin` no access.
 */
export interface FlagParaAdmin {
  chave: ChaveDeFlag;
  rotulo: string;
  descricao: string;
  padrao: boolean;
  /** O valor efetivo agora (linha do banco, ou o padrao se nao ha linha). */
  ligado: boolean;
  /** `true` quando ha linha no banco — ou seja, alguem ja mexeu nesta chave. */
  personalizada: boolean;
  atualizadoPor: string | null;
  atualizadoEm: string | null;
}

/**
 * `true` se a string e uma chave que o registro conhece.
 *
 * `Object.hasOwn`, e nao `in`: `"__proto__" in {}` e `true` pela cadeia de
 * prototipo, e isso deixaria uma chave forjada passar por conhecida.
 */
export function ehChaveDeFlag(valor: string): valor is ChaveDeFlag {
  return Object.hasOwn(FLAGS_CONHECIDAS, valor);
}

/** O padrao de uma chave — usado quando nao ha linha e quando a leitura falha. */
export function padraoDaFlag(chave: ChaveDeFlag): boolean {
  return FLAGS_CONHECIDAS[chave].padrao;
}
