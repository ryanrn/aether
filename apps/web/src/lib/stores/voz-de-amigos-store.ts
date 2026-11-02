"use client";

import { create } from "zustand";
import type { VozDeAmigo } from "@aether/shared";

/**
 * A call de cada amigo, como o gateway deixou VOCE ver (`friend:voice` e
 * `friend:voice-sync`). Store proprio, e nao campo do `realtime-store`: aquele
 * zera mapas ao trocar de servidor, e a call de um amigo nao pertence a
 * servidor aberto nenhum.
 *
 * Aqui nao ha decisao de permissao — o que chega ja foi filtrado no gateway. A
 * tela so desenha; entrar no canal continua revalidado no `voice:join`.
 */
interface VozDeAmigosState {
  porAmigo: Record<string, VozDeAmigo>;
  /** A foto inteira (sync): substitui, porque quem saiu nao vem na lista. */
  substituir: (entradas: { userId: string; voz: VozDeAmigo }[]) => void;
  atualizar: (userId: string, voz: VozDeAmigo | null) => void;
  limpar: () => void;
}

export const useVozDeAmigosStore = create<VozDeAmigosState>((set) => ({
  porAmigo: {},
  substituir: (entradas) =>
    set({
      porAmigo: Object.fromEntries(entradas.map((e) => [e.userId, e.voz])),
    }),
  atualizar: (userId, voz) =>
    set((estado) => {
      if (voz) return { porAmigo: { ...estado.porAmigo, [userId]: voz } };
      if (!(userId in estado.porAmigo)) return estado;
      const { [userId]: _saiu, ...resto } = estado.porAmigo;
      return { porAmigo: resto };
    }),
  limpar: () => set({ porAmigo: {} }),
}));

export function useVozDoAmigo(userId: string): VozDeAmigo | null {
  return useVozDeAmigosStore((estado) => estado.porAmigo[userId] ?? null);
}
