"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "@/components/realtime/realtime-provider";

/**
 * Abrir (ou reaproveitar) a conversa com alguem, a partir do socket.
 *
 * Existia em 4 copias (lista de amigos, menu de voz, cartao de perfil, cartao
 * de atividade) — o mesmo padrao que `useEntrarNaVoz` ja resolveu para voz.
 *
 * E um ida-e-volta pelo socket, e nao um `<Link>` direto: so o servidor sabe
 * o id da conversa, e ela pode nem existir ainda. `dm:open` e idempotente —
 * clicar dez vezes cai sempre na mesma conversa, garantido pelo indice unico
 * sobre o par ordenado no banco.
 */
export function useAbrirConversa() {
  const socket = useSocket();
  const router = useRouter();
  const [abrindo, setAbrindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /**
   * `aoAbrir` roda ANTES de navegar — os cartoes/menus flutuantes usam para
   * se fechar antes da troca de rota; a lista de amigos nao precisa e nao
   * passa nada.
   */
  const abrir = useCallback(
    (userId: string, aoAbrir?: () => void) => {
      if (!socket || abrindo) return;
      setAbrindo(true);
      setErro(null);
      socket.emit("dm:open", { userId }, (resultado) => {
        setAbrindo(false);
        if (!resultado.ok) {
          setErro(resultado.error);
          return;
        }
        aoAbrir?.();
        router.push(`/app/dm/${resultado.dm.id}`);
      });
    },
    [socket, abrindo, router],
  );

  return { abrir, abrindo, erro, limparErro: () => setErro(null) };
}
