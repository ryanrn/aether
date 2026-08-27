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

  /**
   * A gaveta de navegacao esta aberta? So vale no CELULAR.
   *
   * No desktop a trilha de servidores e a arvore de canais sao duas colunas
   * fixas, e nao ha gaveta nenhuma — este estado e ignorado la.
   *
   * Num telefone elas nao cabem: 64px da trilha mais 220px da arvore comem
   * 284px de uma tela de 375px, e sobram 91px para a conversa. Nao e um
   * problema de largura que se ajusta apertando as colunas — tres paineis nao
   * cabem, e o que muda e QUANTOS aparecem por vez.
   *
   * Mora aqui, e nao num contexto novo, porque as duas metades da gaveta
   * nascem em ARQUIVOS DE LAYOUT DIFERENTES: a trilha no layout de `/app`, a
   * arvore no layout do servidor. Elas precisam abrir e fechar juntas, e nao
   * ha ancestral comum que seja componente de cliente.
   */
  navAberta: boolean;
  alternarNav: () => void;
  fecharNav: () => void;
}

export const useShellStore = create<ShellState>((set) => ({
  servers: [],
  setServers: (servers) => set({ servers }),

  // Fechada ao abrir o app: quem entra quer ver a conversa, nao o menu.
  navAberta: false,
  alternarNav: () => set((estado) => ({ navAberta: !estado.navAberta })),
  fecharNav: () => set({ navAberta: false }),
}));
