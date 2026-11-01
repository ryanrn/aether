"use client";

import type { Sugestao } from "@/lib/chat/autocompletar-mencao";
import { cn } from "@/lib/utils";

/**
 * A lista do `@` acima do campo de mensagem. So desenha: quem filtra, navega
 * e aplica e o composer (`autocompletar-mencao.ts` tem a logica).
 *
 * `onMouseDown` com `preventDefault`, e nao `onClick`: o clique tiraria o
 * foco do campo antes de a escolha ser aplicada, e o cursor se perderia.
 */
export function SugestoesDeMencao({
  sugestoes,
  ativa,
  onEscolher,
  onPassar,
}: {
  sugestoes: Sugestao[];
  ativa: number;
  onEscolher: (s: Sugestao) => void;
  onPassar: (indice: number) => void;
}) {
  if (sugestoes.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label="Mencionar"
      className="absolute bottom-full left-4 right-4 z-20 mb-1 overflow-hidden rounded-lg border border-line bg-base-850 py-1 shadow-lg"
    >
      <p className="px-3 pb-1 pt-0.5 text-[10px] uppercase tracking-[0.1em] text-ink-500">
        Mencionar
      </p>
      {sugestoes.map((s, i) => (
        <button
          key={s.tipo === "todos" ? "@everyone" : s.pessoa.id}
          type="button"
          role="option"
          aria-selected={i === ativa}
          onMouseDown={(evento) => {
            evento.preventDefault();
            onEscolher(s);
          }}
          onMouseEnter={() => onPassar(i)}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]",
            i === ativa ? "bg-base-750 text-ink-100" : "text-ink-300",
          )}
        >
          {s.tipo === "todos" ? (
            <>
              <span className="font-medium">@everyone</span>
              <span className="text-[11px] text-ink-500">
                todos que veem este canal
              </span>
            </>
          ) : (
            <>
              {s.pessoa.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={s.pessoa.avatarUrl}
                  alt=""
                  className="h-5 w-5 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-base-700 text-[10px] text-ink-300">
                  {s.pessoa.nome.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="truncate font-medium">{s.pessoa.nome}</span>
              <span className="truncate text-[11px] text-ink-500">
                @{s.pessoa.username}
              </span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
