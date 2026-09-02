"use client";

import { Music2 } from "lucide-react";
import type { MusicActivity } from "@aether/shared";
import { cn } from "@/lib/utils";

/**
 * "Ouvindo <faixa>" — o bloco de musica do Spotify no cartao de atividade e no
 * painel "Ativo agora".
 *
 * Um arquivo so, pela mesma razao do `GameArt`: dois lugares desenham isto, e
 * duas copias divergiriam.
 *
 * A capa e uma URL do CDN do Spotify. Se falhar ao carregar, cai no icone
 * generico — do ponto de vista de quem olha, capa 404 e o mesmo que sem capa.
 * A FASE A nao tem barra de progresso (isso e a fase B).
 */
export function MusicActivityRow({
  musica,
  size = "sm",
}: {
  musica: MusicActivity;
  /** `sm` no cartao; `lg` no painel "Ativo agora", que tem 260px so para arte */
  size?: "sm" | "lg";
}) {
  const arte =
    size === "lg" ? "h-16 w-16 rounded-md" : "h-14 w-14 rounded-[4px]";

  const conteudo = (
    <div className="flex items-start gap-2">
      {musica.art ? (
        // eslint-disable-next-line @next/next/no-img-element -- CDN do Spotify, fora do otimizador
        <img
          src={musica.art}
          alt=""
          className={cn("shrink-0 object-cover", arte)}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <span
          className={cn(
            "grid shrink-0 place-items-center bg-base-800 text-ink-500",
            arte,
          )}
        >
          <Music2 className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0">
        <p className="flex items-center gap-1 text-[11px] font-medium text-[#1DB954]">
          <Music2 className="h-3 w-3 shrink-0" />
          Ouvindo no Spotify
        </p>
        <p className="truncate text-[13px] text-ink-100">{musica.title}</p>
        {musica.artists ? (
          <p className="truncate text-[11px] text-ink-500">{musica.artists}</p>
        ) : null}
      </div>
    </div>
  );

  return musica.url ? (
    <a
      href={musica.url}
      target="_blank"
      rel="noreferrer noopener"
      className="block rounded-md transition-colors hover:bg-base-800/50"
    >
      {conteudo}
    </a>
  ) : (
    conteudo
  );
}
