"use client";

import { create } from "zustand";
import type { PublicServer } from "@aether/shared";

/**
 * O pouco que a casca do app precisa saber fora da arvore de rotas.
 *
 * Existe por causa da barra de titulo: ela mora no layout RAIZ (para as telas
 * de entrada tambem poderem arrastar a janela), mas precisa do nome e do icone
 * do servidor aberto — dados que so o layout de `/app` busca.
 *
 * Uma loja global resolve isso sem inventar contexto novo nem repetir a
 * consulta ao banco. Quem preenche e a barra de servidores, que ja recebe a
 * lista pronta e ja e componente de cliente.
 */
interface ShellState {
  servers: PublicServer[];
  setServers: (servers: PublicServer[]) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  servers: [],
  setServers: (servers) => set({ servers }),
}));
