"use client";

import { useEffect, useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { cn } from "@/lib/utils";

/**
 * A imagem de um jogo, em cadeia de fallback.
 *
 *   1. capa do IGDB        — 264x374, arte de verdade
 *   2. icone do executavel — 48px, extraido na maquina de quem joga
 *   3. icone generico      — nunca falha
 *
 * Mora num arquivo proprio porque DOIS lugares desenham jogo: o cartao de
 * atividade e o painel "Ativo agora" da tela de amigos. Duas copias da cadeia
 * divergiriam, e a divergencia apareceria como imagem quebrada num dos dois —
 * o unico resultado que a cadeia existe para impedir.
 *
 * A falha de CARREGAMENTO tambem cai na cadeia: uma capa que responde 404 (o
 * CDN mudou, a URL envelheceu no cache) e indistinguivel de nao ter capa, do
 * ponto de vista de quem esta olhando a tela.
 */
export function GameArt({
  cover,
  icon,
  className,
  iconClassName,
}: {
  cover: string | null;
  icon: string | null;
  /** tamanho e forma da moldura — quem chama decide */
  className?: string;
  /** tamanho do icone generico, que nao preenche a moldura */
  iconClassName?: string;
}) {
  const [capaFalhou, setCapaFalhou] = useState(false);

  // Capa nova depois de uma que falhou merece nova chance.
  useEffect(() => setCapaFalhou(false), [cover]);

  if (cover && !capaFalhou) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- CDN externo, fora do otimizador
      <img
        src={cover}
        alt=""
        onError={() => setCapaFalhou(true)}
        className={cn("shrink-0 object-cover", className)}
      />
    );
  }

  if (icon) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- data URL, nao ha o que otimizar
      <img
        src={icon}
        alt=""
        className={cn("shrink-0 object-contain", className)}
      />
    );
  }

  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center bg-white/[0.03]",
        className,
      )}
    >
      <AetherIcon
        name="gamepad"
        className={cn("text-ink-500", iconClassName ?? "h-4 w-4")}
        strokeWidth={1.75}
      />
    </span>
  );
}
