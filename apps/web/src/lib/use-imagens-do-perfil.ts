"use client";

import { useEffect, useState } from "react";
import { carregarPerfilAction } from "@/server/actions/perfil";

/**
 * Banner e efeito de perfil de alguem, para os cartoes que abrem da lista de
 * membros e do proprio usuario. Nao estao no `PublicUser` (que o gateway
 * espalha a cada evento) porque so o cartao aberto precisa deles: busca quando
 * o cartao abre, pela mesma action do cartao do chat.
 *
 * Ate a resposta chegar (ou se falhar), vem `null` e o cartao mostra a faixa
 * de cor de sempre.
 */
export function useImagensDoPerfil(
  userId: string,
  serverId?: string,
): { banner: string | null; efeito: string | null } {
  const [imagens, setImagens] = useState<{
    banner: string | null;
    efeito: string | null;
  }>({ banner: null, efeito: null });

  useEffect(() => {
    let vivo = true;
    void carregarPerfilAction({ userId, serverId }).then((r) => {
      if (vivo && r.ok) setImagens({ banner: r.data.banner, efeito: r.data.efeito });
    });
    return () => {
      vivo = false;
    };
  }, [userId, serverId]);

  return imagens;
}
