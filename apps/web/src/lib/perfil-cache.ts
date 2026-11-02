"use client";

import type { PerfilParaCartao } from "@aether/shared";
import { carregarPerfilAction } from "@/server/actions/perfil";

/**
 * CACHE DO CARTAO DE PERFIL — para o cartao abrir ja com banner e efeito.
 *
 * Sem isto o cartao abria, pedia o perfil ao servidor e so depois trocava a
 * faixa de cor pelo banner: um "pisca" a cada clique. Agora:
 *
 *  - passar o ponteiro em quem abre o cartao ja busca o perfil e baixa as
 *    imagens (`preCarregarPerfil`) — no clique, quase sempre ja chegou;
 *  - o cartao comeca com o que esta aqui e SEMPRE busca de novo ao abrir
 *    (stale-while-revalidate): amizade, cargo ou banner trocado aparecem na
 *    hora em que a resposta chega, nunca ficam velhos.
 *
 * So memoria do navegador, por aba. Nao e fonte de verdade de nada — o
 * servidor decide o que o cartao mostra; isto so evita esperar por ele.
 */

const FRESCO_MS = 30_000;

const cache = new Map<string, { perfil: PerfilParaCartao; em: number }>();
const emVoo = new Map<string, Promise<PerfilParaCartao | null>>();

function chave(userId: string, serverId?: string): string {
  return `${userId}|${serverId ?? ""}`;
}

/** Baixa a imagem para o cache HTTP do navegador; quando o `<img>` montar, ja tem. */
function baixarImagem(url: string | null) {
  if (!url || typeof window === "undefined") return;
  const img = new window.Image();
  img.decoding = "async";
  img.src = url;
}

export function perfilEmCache(
  userId: string,
  serverId?: string,
): PerfilParaCartao | null {
  return cache.get(chave(userId, serverId))?.perfil ?? null;
}

/**
 * Banner e efeito nao dependem do servidor aberto: qualquer entrada da pessoa
 * serve para os cartoes que so mostram as imagens.
 */
export function imagensEmCache(
  userId: string,
): { banner: string | null; efeito: string | null } | null {
  const exata = cache.get(chave(userId));
  const qualquer =
    exata ??
    [...cache.entries()].find(([k]) => k.startsWith(`${userId}|`))?.[1];
  return qualquer
    ? { banner: qualquer.perfil.banner, efeito: qualquer.perfil.efeito }
    : null;
}

/** Busca no servidor (uma requisicao por chave de cada vez) e guarda. */
export function buscarPerfil(
  userId: string,
  serverId?: string,
): Promise<PerfilParaCartao | null> {
  const k = chave(userId, serverId);
  const pendente = emVoo.get(k);
  if (pendente) return pendente;

  const promessa = carregarPerfilAction({ userId, serverId })
    .then((r) => {
      if (!r.ok) return null;
      cache.set(k, { perfil: r.data, em: Date.now() });
      baixarImagem(r.data.banner);
      baixarImagem(r.data.efeito);
      return r.data;
    })
    .catch(() => null)
    .finally(() => emVoo.delete(k));
  emVoo.set(k, promessa);
  return promessa;
}

/** No hover: busca so se nao houver resposta recente. */
export function preCarregarPerfil(userId: string, serverId?: string): void {
  const atual = cache.get(chave(userId, serverId));
  if (atual && Date.now() - atual.em < FRESCO_MS) return;
  void buscarPerfil(userId, serverId);
}

/** O cartao mudou algo localmente (pedido de amizade enviado, etc.). */
export function guardarPerfil(
  userId: string,
  serverId: string | undefined,
  perfil: PerfilParaCartao,
): void {
  cache.set(chave(userId, serverId), { perfil, em: Date.now() });
}

/** Depois de equipar um cosmetico: o proximo cartao nao pode mostrar o antigo. */
export function esquecerPerfil(userId: string): void {
  for (const k of [...cache.keys()]) {
    if (k.startsWith(`${userId}|`)) cache.delete(k);
  }
}
