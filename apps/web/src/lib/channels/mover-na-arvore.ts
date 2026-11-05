import {
  reposicionar,
  type PublicCategory,
  type PublicChannel,
} from "@aether/shared";

/**
 * A arvore de canais como a TELA a mostra logo depois de soltar um canal,
 * ANTES de o servidor responder (atualizacao otimista).
 *
 * Usa `reposicionar` (de @aether/shared), a mesma conta que
 * `reorderChannel` faz no servidor: quando a resposta chegar e a arvore vier
 * do servidor, o canal ja esta no lugar e nao "pula".
 *
 * Pura: recebe a arvore e devolve outra, sem mexer na original — e a original
 * que volta se o servidor recusar.
 */
export interface ArvoreDeCanais {
  categories: PublicCategory[];
  looseChannels: PublicChannel[];
}

export function moverCanalNaArvore(
  arvore: ArvoreDeCanais,
  channelId: string,
  categoriaDestino: string | null,
  indice: number,
): ArvoreDeCanais {
  const canal =
    arvore.looseChannels.find((c) => c.id === channelId) ??
    arvore.categories.flatMap((c) => c.channels).find((c) => c.id === channelId);
  if (!canal) return arvore;
  // Categoria que nao esta na arvore: nao inventa — o servidor decide.
  if (
    categoriaDestino !== null &&
    !arvore.categories.some((c) => c.id === categoriaDestino)
  ) {
    return arvore;
  }

  const movido: PublicChannel = { ...canal, categoryId: categoriaDestino };

  /** Os canais de um container depois do movimento. */
  const reordenar = (lista: PublicChannel[], ehDestino: boolean): PublicChannel[] => {
    const semEle = lista.filter((c) => c.id !== channelId);
    if (!ehDestino) return semEle;
    const ids = reposicionar(
      lista.map((c) => c.id),
      channelId,
      indice,
    );
    const porId = new Map(semEle.map((c) => [c.id, c]));
    porId.set(channelId, movido);
    return ids.map((id) => porId.get(id)!);
  };

  return {
    looseChannels: reordenar(arvore.looseChannels, categoriaDestino === null),
    categories: arvore.categories.map((categoria) => ({
      ...categoria,
      channels: reordenar(categoria.channels, categoria.id === categoriaDestino),
    })),
  };
}
