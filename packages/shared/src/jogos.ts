import { z } from "zod";

/**
 * A biblioteca de jogos da comunidade.
 *
 * POR QUE EXISTE: a deteccao so conhece jogo que alguma LOJA declarou ter
 * instalado. Jogo fora de loja nao tem quem responda "onde voce esta" — as
 * pessoas respondem.
 *
 * O QUE VIAJA E O EXECUTAVEL, NUNCA O CAMINHO. Duas razoes, e as duas bastam
 * sozinhas:
 *
 *  1. Privacidade. O caminho carrega o nome de usuario do Windows quase sempre
 *     (`C:/Users/fulano/...`), e uma biblioteca compartilhada o exporia para
 *     todo mundo, para sempre.
 *  2. Nem funcionaria. Cada pessoa instala em disco e pasta diferentes; o
 *     nome do executavel e o mesmo em toda maquina.
 */

/**
 * O executavel reduzido ao que da para comparar: minusculas, sem extensao e
 * sem pontuacao.
 *
 * MESMA REGRA que o `game-detect` do desktop usa para casar processo com jogo.
 * Se as duas divergirem, uma sugestao aprovada deixa de casar com o processo
 * que a originou — e o defeito e silencioso, porque o jogo simplesmente
 * continua sem aparecer.
 */
export function normalizarExecutavel(texto: string): string {
  return String(texto ?? "")
    .toLowerCase()
    .replace(/\.exe$/, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * A forma canonica de um NOME DE JOGO (nao de executavel), para servir de
 * chave de comparacao.
 *
 * Diferente de `normalizarExecutavel`: aqui espacos e digitos FICAM. "Portal
 * 2", "Cyberpunk 2077" e "Grand Theft Auto V" viram jogos diferentes se os
 * numeros sumirem, e colar as palavras ("grandtheftautov") tira a unica forma
 * legivel de o dono conferir o que digitou.
 *
 * O que sai:
 *  - minusculas;
 *  - `.exe` no fim (o cadastro manual as vezes cola o executavel);
 *  - simbolos de marca (™ ® ©), comuns em nome de manifesto de loja;
 *  - apostrofo some SEM virar espaco ("marvel's" = "marvels");
 *  - qualquer outra pontuacao vira espaco, e espacos colapsam.
 *
 * MESMA REGRA nos dois lados: o app web calcula isto ao vincular um jogo a um
 * cargo (`Role.jogoNormalizado`) e o gateway calcula ao receber `presence:game`
 * para casar. Se divergirem, o cargo por jogo para de casar em silencio.
 * `apps/realtime/src/games/normalize.ts` re-exporta esta funcao.
 */
export function normalizarNome(bruto: string): string {
  return String(bruto ?? "")
    .toLowerCase()
    .replace(/\.exe$/i, "")
    .replace(/[™®©]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Nome de executavel que aceitamos receber.
 *
 * O limite de tamanho e a lista de caracteres NAO sao decoracao: isto vem do
 * cliente, entra num banco compartilhado e volta para a tela de todo mundo.
 * Sem limite, uma sugestao de 10 MB; sem filtro de caractere, caminho
 * disfarcado de nome de arquivo.
 *
 * BARRA E DOIS-PONTOS SAO PROIBIDOS de proposito: sao o que transforma um nome
 * de executavel em caminho. Recusar aqui e a garantia de que nenhum caminho
 * entra na biblioteca nem por acidente nem de proposito.
 */
export const executavelSchema = z
  .string()
  .trim()
  .min(3, "Nome de executavel muito curto")
  .max(120, "Nome de executavel muito longo")
  .refine((v) => !/[\\/:]/.test(v), "Envie o nome do programa, nao o caminho")
  .refine(
    (v) => normalizarExecutavel(v).length >= 3,
    "Nome de executavel muito curto",
  );

/**
 * O nome do jogo como a pessoa sugere.
 *
 * Mais permissivo que o executavel — nome de jogo tem acento, dois-pontos e
 * numero romano — mas ainda limitado, porque tambem vai para a tela de todo
 * mundo depois de aprovado.
 */
export const nomeDeJogoSchema = z
  .string()
  .trim()
  .min(2, "Nome muito curto")
  .max(80, "Nome muito longo");

export const sugerirJogoSchema = z.object({
  executavel: executavelSchema,
  nome: nomeDeJogoSchema,
});

export type StatusDeJogo = "PENDENTE" | "APROVADO" | "RECUSADO";

/** Uma entrada do catalogo aprovado, como o cliente a consome. */
export interface JogoConhecido {
  /** o executavel normalizado — e por ele que o desktop casa */
  chave: string;
  nome: string;
}

/** Uma linha da fila de revisao. So a equipe ve isto. */
export interface JogoNaFila extends JogoConhecido {
  id: string;
  /** como o executavel foi visto, para a revisao reconhecer do que se trata */
  executavel: string;
  status: StatusDeJogo;
  /** quantas PESSOAS distintas sugeriram — o sinal de que e jogo de verdade */
  sugestoes: number;
  createdAt: string;
}
