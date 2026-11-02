"use client";

import { useEffect, useState } from "react";
import { buscarPerfil, imagensEmCache } from "@/lib/perfil-cache";

/**
 * Banner e efeito de perfil de alguem, para os cartoes que abrem da lista de
 * membros e do proprio usuario. Nao estao no `PublicUser` (que o gateway
 * espalha a cada evento) porque so o cartao aberto precisa deles.
 *
 * Comeca com o que o `perfil-cache` ja tem (o hover costuma ter buscado) e
 * busca de novo ao abrir. `pronto` diz se ja ha resposta — antes dela a faixa
 * fica neutra, em vez de mostrar a cor padrao e trocar logo depois.
 */
export function useImagensDoPerfil(userId: string): {
  banner: string | null;
  efeito: string | null;
  pronto: boolean;
} {
  const [imagens, setImagens] = useState(() => {
    const emCache = imagensEmCache(userId);
    return emCache
      ? { ...emCache, pronto: true }
      : { banner: null, efeito: null, pronto: false };
  });

  useEffect(() => {
    let vivo = true;
    void buscarPerfil(userId).then((perfil) => {
      if (!vivo) return;
      setImagens({
        banner: perfil?.banner ?? null,
        efeito: perfil?.efeito ?? null,
        pronto: true,
      });
    });
    return () => {
      vivo = false;
    };
  }, [userId]);

  return imagens;
}
