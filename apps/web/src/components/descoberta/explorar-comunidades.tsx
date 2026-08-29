"use client";

import { useCallback, useEffect, useState } from "react";
import { Compass, Search } from "lucide-react";
import {
  CATEGORIAS_DE_COMUNIDADE,
  type ComunidadeNaVitrine,
} from "@aether/shared";
import { listarVitrineAction } from "@/server/actions/descoberta";
import { cn } from "@/lib/utils";
import { ComunidadeCard } from "./comunidade-card";

/**
 * "Explorar comunidades".
 *
 * A ESTRUTURA veio da maquete: filtros de categoria em pilulas, uma busca ao
 * lado, e uma grade de cards abaixo. As cores nao — a maquete usa a paleta
 * padrao do Tailwind, e o app tem tokens proprios.
 *
 * A busca e a categoria vao ao SERVIDOR, e nao filtram uma lista ja baixada:
 * a vitrine cresce, e filtrar no cliente exigiria baixar tudo para mostrar
 * doze cards.
 */

/** Espera antes de buscar, para nao disparar uma consulta por tecla. */
const ESPERA_MS = 300;

export function ExplorarComunidades({
  inicial,
}: {
  inicial: ComunidadeNaVitrine[];
}) {
  const [categoria, setCategoria] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [comunidades, setComunidades] = useState(inicial);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /** A primeira renderizacao ja veio pronta do servidor; nao refazer. */
  const [primeira, setPrimeira] = useState(true);

  const buscar = useCallback(async (cat: string | null, termo: string) => {
    setCarregando(true);
    setErro(null);
    const r = await listarVitrineAction(cat, termo);
    if (r.ok) setComunidades(r.data.comunidades);
    else setErro(r.error);
    setCarregando(false);
  }, []);

  useEffect(() => {
    if (primeira) {
      setPrimeira(false);
      return;
    }
    const timer = setTimeout(() => void buscar(categoria, busca), ESPERA_MS);
    return () => clearTimeout(timer);
    // `primeira` fica de fora: ela so guarda o primeiro passe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoria, busca, buscar]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-base-800 px-6 py-5">
        <div className="flex items-center gap-2.5">
          <Compass className="h-5 w-5 text-accent-400" />
          <h1 className="text-[17px] font-semibold text-ink-100">
            Explorar comunidades
          </h1>
        </div>
        <p className="mt-1 text-[13px] text-ink-500">
          Servidores abertos a quem quiser entrar.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            <PilulaDeCategoria
              ativa={categoria === null}
              onClick={() => setCategoria(null)}
            >
              Todos
            </PilulaDeCategoria>
            {CATEGORIAS_DE_COMUNIDADE.map((c) => (
              <PilulaDeCategoria
                key={c.id}
                ativa={categoria === c.id}
                onClick={() => setCategoria(c.id)}
              >
                {c.nome}
              </PilulaDeCategoria>
            ))}
          </div>

          <div className="relative ml-auto min-w-[220px] flex-1 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar comunidades"
              maxLength={60}
              aria-label="Buscar comunidades"
              className="h-9 w-full rounded-md border border-base-800 bg-base-950 pl-8 pr-3 text-[13px] text-ink-100 placeholder:text-ink-600 focus:border-accent-500 focus:outline-none"
            />
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {erro ? (
          <p className="rounded-md border border-signal-dnd/30 bg-signal-dnd/10 px-3 py-2 text-[13px] text-signal-dnd">
            {erro}
          </p>
        ) : null}

        {comunidades.length === 0 && !carregando ? (
          <div className="rounded-lg border border-base-800 bg-base-900 px-4 py-10 text-center">
            <p className="text-[13px] text-ink-400">
              {busca || categoria
                ? "Nada encontrado com esse filtro."
                : "Ainda nao ha comunidades publicas."}
            </p>
            <p className="mt-1 text-[12px] text-ink-600">
              Um servidor aparece aqui quando o dono liga a vitrine nas
              configuracoes dele.
            </p>
          </div>
        ) : (
          <div
            className={cn(
              "grid gap-3 transition-opacity",
              "grid-cols-[repeat(auto-fill,minmax(240px,1fr))]",
              carregando && "opacity-50",
            )}
          >
            {comunidades.map((c) => (
              <ComunidadeCard key={c.id} comunidade={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PilulaDeCategoria({
  ativa,
  onClick,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativa}
      className={cn(
        "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
        ativa
          ? "bg-accent-500 text-white"
          : "bg-base-850 text-ink-400 hover:bg-base-800 hover:text-ink-200",
      )}
    >
      {children}
    </button>
  );
}
