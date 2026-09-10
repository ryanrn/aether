"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  aoReceberDeepLink,
  confirmarDeepLink,
  deepLinkPendente,
} from "@/lib/desktop/deep-link";

/**
 * Leva um deep link do app de desktop (`aether://invite/<codigo>`) ate a rota.
 *
 * Nao desenha nada. Mora no layout RAIZ — precisa existir em qualquer tela,
 * inclusive na de login (o convite pode chegar com a pessoa deslogada). No
 * navegador `window.aetherDesktop` nao existe e este componente e inerte.
 *
 * A navegacao e client-side (`router.replace`): no desktop isso NAO recarrega
 * a janela nem derruba uma call de voz em andamento. A pagina `/invite/...`
 * faz o resto (validar, login se preciso, aceitar, abrir o servidor).
 */
export function DeepLinkListener() {
  const router = useRouter();

  useEffect(() => {
    let vivo = true;

    // (1) Deep link que chegou antes deste ouvinte existir — ou que abriu o
    // app do zero.
    void deepLinkPendente().then((caminho) => {
      if (vivo && caminho) {
        confirmarDeepLink();
        router.replace(caminho);
      }
    });

    // (2) Deep links com o app ja aberto.
    const cancelar = aoReceberDeepLink((caminho) => {
      confirmarDeepLink();
      router.replace(caminho);
    });

    return () => {
      vivo = false;
      cancelar();
    };
  }, [router]);

  return null;
}
