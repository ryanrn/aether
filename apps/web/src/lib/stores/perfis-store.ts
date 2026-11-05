"use client";

import { create } from "zustand";
import type { PublicUser } from "@aether/shared";

/**
 * O perfil MAIS RECENTE de cada pessoa que mudou foto, moldura, nome,
 * decoracao ou placa desde que esta tela abriu (`user:profile`).
 *
 * Por que existe: varias telas guardam uma copia do autor/membro tirada quando
 * carregaram — as mensagens do chat, principalmente, que vivem no
 * `realtime-store` e nao voltam do servidor num `router.refresh()`. Sem um
 * lugar com "a versao nova", a foto e o nome antigos ficavam ate a pessoa
 * reabrir o app.
 *
 * So os campos que mudam pelas configuracoes de perfil. `status`, `plano` e o
 * resto continuam vindo de onde sempre vieram — o evento nao e a fonte deles.
 *
 * Store proprio, e nao campo do `realtime-store`: aquele zera mapas ao trocar
 * de servidor, e o perfil de alguem nao pertence a servidor nenhum.
 */
export type PerfilAoVivo = Pick<
  PublicUser,
  "displayName" | "avatarUrl" | "moldura" | "decoracao" | "placa"
>;

interface PerfisState {
  porUsuario: Record<string, PerfilAoVivo>;
  atualizar: (user: PublicUser) => void;
}

export const usePerfisStore = create<PerfisState>((set) => ({
  porUsuario: {},
  atualizar: (user) =>
    set((estado) => ({
      porUsuario: {
        ...estado.porUsuario,
        [user.id]: {
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          moldura: user.moldura,
          decoracao: user.decoracao,
          placa: user.placa,
        },
      },
    })),
}));

/** `null` = nada mudou desde que a tela abriu; use o que ja tinha. */
export function usePerfilAoVivo(userId: string): PerfilAoVivo | null {
  return usePerfisStore((estado) => estado.porUsuario[userId] ?? null);
}

/**
 * O usuario com o perfil mais recente por cima. Devolve O MESMO objeto quando
 * nada mudou, para nao quebrar memo de quem recebe.
 */
export function comPerfilAoVivo<T extends PublicUser>(
  user: T,
  aoVivo: PerfilAoVivo | null,
): T {
  return aoVivo ? { ...user, ...aoVivo } : user;
}
