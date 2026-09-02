"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { AetherIcon } from "@/components/ui/aether-icon";
import { useShellStore } from "@/lib/stores/shell-store";

/**
 * A gaveta de navegacao do CELULAR.
 *
 * No desktop nada aqui aparece: a trilha de servidores e a arvore de canais
 * sao colunas de verdade, lado a lado. Num telefone elas somam 284px de uma
 * tela de 375 e deixam 91px para a conversa — entao viram uma gaveta que
 * cobre o conteudo enquanto esta aberta, como no Discord.
 *
 * As classes que movem a gaveta moram nos proprios componentes (trilha e
 * arvore), porque e la que a posicao faz sentido. O que mora AQUI e o que nao
 * pertence a nenhum dos dois: o fundo escuro, o botao que abre, e a regra de
 * fechar ao navegar.
 */

/**
 * O deslocamento que esconde a gaveta inteira.
 *
 * 284px = 64 da trilha + 220 da arvore. As duas usam o MESMO valor de propria
 * vontade: a trilha comeca em `left-0` e a arvore em `left-16`, entao deslocar
 * as duas por 284 poe as duas inteiramente fora da tela, sem sobra de uma
 * espiando por tras da outra. Deslocar cada uma pela propria largura deixaria
 * a arvore com a borda direita exatamente em 64px — em cima da trilha.
 */
export const NAV_ESCONDIDA = "max-md:-translate-x-[284px]";
export const NAV_VISIVEL = "max-md:translate-x-0";

/** As classes de posicao comuns as duas metades da gaveta. */
export const NAV_GAVETA =
  "max-md:fixed max-md:inset-y-0 max-md:z-40 max-md:transition-transform max-md:duration-200";

/**
 * O fundo escuro atras da gaveta aberta.
 *
 * Alem de escurecer, ele CAPTURA o toque: sem isso, tocar na conversa por tras
 * da gaveta acertaria a mensagem em vez de fechar o menu, que e o que qualquer
 * um espera fazer.
 */
export function NavBackdrop() {
  const aberta = useShellStore((estado) => estado.navAberta);
  const fechar = useShellStore((estado) => estado.fecharNav);
  const caminho = usePathname();

  /**
   * Trocar de canal FECHA a gaveta.
   *
   * E o gesto inteiro: abro o menu, escolho o canal, quero ver o canal. Sem
   * isto a gaveta ficaria por cima do que a pessoa acabou de pedir para ver.
   *
   * Preso ao caminho da rota em vez de a um `onClick` em cada link: assim vale
   * para qualquer navegacao — canal, conversa, tela de amigos — inclusive as
   * que ainda nao existem.
   */
  useEffect(() => {
    fechar();
  }, [caminho, fechar]);

  if (!aberta) return null;

  return (
    <button
      type="button"
      aria-label="Fechar menu"
      onClick={fechar}
      className="fixed inset-0 z-30 bg-black/60 md:hidden"
    />
  );
}

/**
 * O botao que abre a gaveta. Vai no cabecalho de cada tela.
 *
 * `md:hidden` porque no desktop nao ha gaveta para abrir — as colunas ja estao
 * na tela, e um botao que nao faz nada visivel e pior do que botao nenhum.
 */
export function NavToggle() {
  const alternar = useShellStore((estado) => estado.alternarNav);

  return (
    <button
      type="button"
      onClick={alternar}
      aria-label="Abrir menu de canais"
      className="-ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-300 transition-colors hover:bg-base-800 hover:text-ink-100 md:hidden"
    >
      <AetherIcon name="menu" className="h-4.5 w-4.5" strokeWidth={2} />
    </button>
  );
}
