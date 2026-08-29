import { z } from "zod";

/**
 * Explorar comunidades — a vitrine de servidores publicos.
 *
 * APARECER AQUI E OPT-IN DO DONO. A maioria dos servidores e um grupo de
 * amigos que nunca pediu vitrine; listar por existir exporia nome, icone e
 * tamanho de todos eles sem ninguem ter escolhido isso.
 */

/**
 * As categorias.
 *
 * CATALOGO EM CODIGO, e o banco guarda so o id — mesmo desenho de `PLANS` e
 * `MOLDURAS`. Texto livre fragmentaria em "Games", "Gaming", "gaming" e
 * "JOGOS", e a vitrine viraria uma lista de categorias com um servidor cada.
 *
 * A lista e curta de proposito. Categoria demais espalha os poucos servidores
 * que existem e faz a vitrine parecer vazia em todo filtro.
 */
export interface CategoriaDeComunidade {
  id: string;
  nome: string;
}

export const CATEGORIAS_DE_COMUNIDADE: readonly CategoriaDeComunidade[] = [
  { id: "gaming", nome: "Games" },
  { id: "musica", nome: "Musica" },
  { id: "entretenimento", nome: "Entretenimento" },
  { id: "tecnologia", nome: "Tecnologia" },
  { id: "estudos", nome: "Estudos" },
  { id: "comunidade", nome: "Comunidade" },
] as const;

const CATEGORIAS_POR_ID = new Map(
  CATEGORIAS_DE_COMUNIDADE.map((c) => [c.id, c]),
);

export function categoriaPorId(
  id: string | null | undefined,
): CategoriaDeComunidade | null {
  if (!id) return null;
  return CATEGORIAS_POR_ID.get(id) ?? null;
}

/**
 * Categoria removida do catalogo vira nula na leitura, sem quebrar a tela de
 * quem a tinha escolhido — mesma regra da moldura.
 */
export function ehCategoriaValida(id: string | null | undefined): boolean {
  return id === null || id === undefined || CATEGORIAS_POR_ID.has(id);
}

/**
 * A descricao que aparece no card.
 *
 * Curta de proposito: o card tem duas linhas, e texto que nao cabe ou seria
 * cortado no meio de uma palavra ou empurraria o resto do card. Limitar na
 * entrada e mais honesto do que cortar na saida.
 */
export const descricaoDeComunidadeSchema = z
  .string()
  .trim()
  .max(160, "A descricao cabe em 160 caracteres");

export const ajustesDeVitrineSchema = z.object({
  publico: z.boolean(),
  descricao: descricaoDeComunidadeSchema,
  categoria: z
    .string()
    .nullable()
    .refine(ehCategoriaValida, "Categoria desconhecida"),
});

/** O termo de busca. Vazio = sem busca, e nao "nenhum resultado". */
export const buscaDeComunidadeSchema = z.string().trim().max(60);

/** Um servidor na vitrine, como o card o consome. */
export interface ComunidadeNaVitrine {
  id: string;
  nome: string;
  iconUrl: string | null;
  descricao: string | null;
  categoria: string | null;
  /** Oficial do Aether: fixado no topo e com selo. */
  oficial: boolean;
  membros: number;
  /**
   * Quantos estao online AGORA, ou `null` quando nao foi possivel saber.
   *
   * `null` e diferente de zero de proposito: a presenca vive na memoria do
   * gateway, e se ele nao responder, "ninguem online" seria mentira. A tela
   * mostra so o total nesse caso.
   */
  online: number | null;
  /** Ja sou membro? O card troca "Entrar" por "Abrir". */
  souMembro: boolean;
}
