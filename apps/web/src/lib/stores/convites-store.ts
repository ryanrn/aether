"use client";

import { create } from "zustand";
import type { ConviteDeJogo } from "@aether/shared";

/**
 * Os convites de jogo da pessoa (enviados e recebidos) e o jogo dela agora.
 *
 * Espelho do gateway, nada mais: `game-invite:update` atualiza um,
 * `game-invite:list` (a cada `friend:sync`) substitui tudo. Regra nenhuma
 * mora aqui — quem pode responder, cancelar ou pedir e decidido no gateway.
 */
interface ConvitesState {
  porId: Record<string, ConviteDeJogo>;
  /** O jogo que o gateway sabe que voce esta jogando (vem do app de desktop). */
  meuJogo: string | null;
  /** Avisos de resultado que a pessoa ja fechou nesta aba. */
  dispensados: Record<string, true>;
  atualizar: (convite: ConviteDeJogo) => void;
  substituir: (convites: ConviteDeJogo[], meuJogo: string | null) => void;
  setMeuJogo: (jogo: string | null) => void;
  dispensar: (id: string) => void;
}

export const useConvitesStore = create<ConvitesState>((set) => ({
  porId: {},
  meuJogo: null,
  dispensados: {},
  atualizar: (convite) =>
    set((estado) => ({ porId: { ...estado.porId, [convite.id]: convite } })),
  substituir: (convites, meuJogo) =>
    set({ porId: Object.fromEntries(convites.map((c) => [c.id, c])), meuJogo }),
  setMeuJogo: (meuJogo) => set({ meuJogo }),
  dispensar: (id) =>
    set((estado) => ({ dispensados: { ...estado.dispensados, [id]: true } })),
}));

/**
 * O convite mais recente entre voce e `outroId` deste tipo, na direcao dada —
 * e o que decide o botao: "Pedir para entrar", "Pedido enviado" ou "Aceito".
 */
export function useConviteCom(
  selfId: string | null,
  outroId: string,
  tipo: ConviteDeJogo["tipo"],
): ConviteDeJogo | null {
  return useConvitesStore((estado) => {
    if (!selfId) return null;
    let melhor: ConviteDeJogo | null = null;
    for (const c of Object.values(estado.porId)) {
      if (c.tipo !== tipo || c.de.id !== selfId || c.para.id !== outroId) continue;
      if (!melhor || c.criadoEm > melhor.criadoEm) melhor = c;
    }
    return melhor;
  });
}
