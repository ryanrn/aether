"use client";

import { create } from "zustand";

/**
 * Fila de toasts, num lugar so.
 *
 * POR QUE EXISTE: cada confirmacao de sucesso no app era um texto inline
 * bespoke (`account-tab.tsx`, `roles-tab.tsx`, `member-roles-modal.tsx`...) —
 * funciona, mas nada garante que a PROXIMA tela vai lembrar de adicionar. Isto
 * e o primitivo pronto: `toast.sucesso("Salvo.")` de qualquer lugar, sem
 * precisar reinventar estado local nem o `setTimeout` de sumir sozinho.
 *
 * Nao substitui as confirmacoes inline que ja existem — aquelas moram do LADO
 * do botao que a pessoa clicou, o que e melhor quando da pra fazer. O toast e
 * para o caso sem esse lugar: uma acao que nao tem um pedaco de tela fixo por
 * perto para confirmar em cima.
 */

export type TipoDeToast = "sucesso" | "erro" | "info";

export interface ToastItem {
  id: string;
  tipo: TipoDeToast;
  texto: string;
}

interface ToastState {
  itens: ToastItem[];
  mostrar: (texto: string, tipo?: TipoDeToast) => string;
  remover: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  itens: [],
  mostrar: (texto, tipo = "sucesso") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    set((estado) => ({ itens: [...estado.itens, { id, texto, tipo }] }));
    return id;
  },
  remover: (id) =>
    set((estado) => ({ itens: estado.itens.filter((t) => t.id !== id) })),
}));

/**
 * API de fora de componente — a MESMA pilha do hook, sem precisar montar um
 * `useToastStore` so para disparar um toast dentro de um `then()`/callback de
 * socket que nao e corpo de componente.
 */
export const toast = {
  sucesso: (texto: string) => useToastStore.getState().mostrar(texto, "sucesso"),
  erro: (texto: string) => useToastStore.getState().mostrar(texto, "erro"),
  info: (texto: string) => useToastStore.getState().mostrar(texto, "info"),
};
