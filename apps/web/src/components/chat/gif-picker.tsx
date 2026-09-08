"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { cn } from "@/lib/utils";

/**
 * Seletor de GIF (Tenor, via `/api/gif`).
 *
 * Feito para virar seletor de STICKER tambem: a grade, a busca e a paginacao
 * nao sabem que e GIF — trocar a fonte de dados basta. Por isso o `<MediaPicker>`
 * ja tem a aba parada de sticker.
 *
 * Sem `TENOR_API_KEY` no servidor, `/api/gif` responde `disponivel: false` e
 * aqui aparece so o aviso de "em breve".
 */
export interface GifEscolhido {
  url: string;
  previa: string;
  descricao: string;
  largura: number;
  altura: number;
}

interface Resposta {
  disponivel: boolean;
  resultados?: GifEscolhido[];
  proximaPos?: string | null;
  categorias?: { nome: string; busca: string; previa: string }[];
  erro?: boolean;
}

export function GifPicker({
  onEscolher,
}: {
  onEscolher: (gif: GifEscolhido) => void;
}) {
  /** null carregando · "ok" · "sem-chave" · "erro" */
  const [estado, setEstado] = useState<null | "ok" | "sem-chave" | "erro">(null);
  const [busca, setBusca] = useState("");
  const [itens, setItens] = useState<GifEscolhido[]>([]);
  const [pos, setPos] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [categorias, setCategorias] = useState<Resposta["categorias"]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** cada busca ganha um numero; respostas de buscas antigas sao descartadas */
  const geracao = useRef(0);

  const carregar = useCallback(
    async (termo: string, continuar: boolean) => {
      const geracaoAtual = continuar ? geracao.current : ++geracao.current;
      setCarregando(true);
      try {
        const params = new URLSearchParams();
        if (termo) {
          params.set("tipo", "busca");
          params.set("q", termo);
        } else {
          params.set("tipo", "alta");
        }
        if (continuar && pos) params.set("pos", pos);

        const resp = await fetch(`/api/gif?${params}`);
        const r = (await resp.json().catch(() => ({}))) as Resposta;
        if (geracaoAtual !== geracao.current) return;

        if (r.disponivel === false) {
          setEstado("sem-chave");
          return;
        }
        if (!resp.ok || r.disponivel !== true) {
          setEstado("erro");
          return;
        }
        setEstado("ok");
        setItens((antigos) =>
          continuar ? [...antigos, ...(r.resultados ?? [])] : (r.resultados ?? []),
        );
        setPos(r.proximaPos ?? null);
      } catch {
        if (geracaoAtual === geracao.current) setEstado("erro");
      } finally {
        if (geracaoAtual === geracao.current) setCarregando(false);
      }
    },
    [pos],
  );

  // primeira carga: em alta + categorias
  useEffect(() => {
    void carregar("", false);
    void fetch("/api/gif?tipo=categorias")
      .then((x) => x.json())
      .then((r: Resposta) => setCategorias(r.categorias ?? []))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // busca com folga — nao dispara a cada tecla
  useEffect(() => {
    const t = setTimeout(() => void carregar(busca.trim(), false), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  function aoRolar() {
    const el = scrollRef.current;
    if (!el || carregando || !pos) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) {
      void carregar(busca.trim(), true);
    }
  }

  if (estado === "sem-chave" || estado === "erro") {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <p className="text-[12px] leading-relaxed text-ink-500">
          {estado === "sem-chave"
            ? "O envio de GIF ainda nao esta ligado — falta a chave do Tenor."
            : "Nao deu para carregar os GIFs agora. Tente de novo em instantes."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 p-2">
        <div className="flex items-center gap-2 rounded-md border border-line bg-base-900 px-2.5">
          <AetherIcon name="search" className="h-3.5 w-3.5 text-ink-500" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar no Tenor"
            className="h-8 flex-1 bg-transparent text-[13px] text-ink-100 outline-none placeholder:text-ink-600"
          />
          {busca ? (
            <button
              type="button"
              onClick={() => setBusca("")}
              aria-label="Limpar"
              className="text-ink-500 hover:text-ink-200"
            >
              <AetherIcon name="x" className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {!busca && categorias && categorias.length > 0 ? (
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {categorias.slice(0, 10).map((c) => (
              <button
                key={c.busca}
                type="button"
                onClick={() => setBusca(c.busca)}
                className="shrink-0 rounded-full border border-line bg-base-900 px-2.5 py-1 text-[11px] text-ink-300 transition-colors hover:border-line-strong hover:text-ink-100"
              >
                {c.nome}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        onScroll={aoRolar}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
      >
        <div className="columns-2 gap-2 [&>*]:mb-2">
          {itens.map((g, i) => (
            <button
              key={`${g.url}-${i}`}
              type="button"
              onClick={() => onEscolher(g)}
              title={g.descricao}
              className="block w-full overflow-hidden rounded-md border border-line bg-base-900 transition-colors hover:border-accent-500/60"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={g.previa}
                alt={g.descricao}
                loading="lazy"
                className="w-full"
                style={
                  g.largura && g.altura
                    ? { aspectRatio: `${g.largura} / ${g.altura}` }
                    : undefined
                }
              />
            </button>
          ))}
        </div>

        {carregando ? (
          <div className="flex justify-center py-3">
            <AetherIcon
              name="loader"
              className="h-4 w-4 animate-spin text-ink-600"
            />
          </div>
        ) : null}

        {!carregando && itens.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12px] text-ink-500">
            {busca ? "Nada encontrado." : "Sem GIFs em alta agora."}
          </p>
        ) : null}
      </div>

      <p className="shrink-0 border-t border-line px-3 py-1.5 text-[9px] uppercase tracking-[0.1em] text-ink-600">
        via Tenor
      </p>
    </div>
  );
}
