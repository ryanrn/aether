"use client";

import { useEffect, useState, useTransition } from "react";
import { BadgeCheck } from "lucide-react";
import { CATEGORIAS_DE_COMUNIDADE } from "@aether/shared";
import { lerVitrineAction, salvarVitrineAction } from "@/server/actions/descoberta";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Aparecer em "Explorar comunidades".
 *
 * DESLIGADO POR PADRAO. A maioria dos servidores e um grupo de amigos que
 * nunca pediu vitrine, e listar por existir exporia nome, icone e tamanho de
 * todos eles sem ninguem ter escolhido isso.
 *
 * O selo OFICIAL aparece aqui como informacao, e nunca como chave: quem marca
 * e a equipe, por script. Selo que o proprio interessado se da nao vale nada.
 */
export function VitrineSection({ serverId }: { serverId: string }) {
  const [carregando, setCarregando] = useState(true);
  const [publico, setPublico] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [oficial, setOficial] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void lerVitrineAction(serverId)
      .then((r) => {
        if (!r.ok) {
          setErro(r.error);
          return;
        }
        setPublico(r.data.publico);
        setDescricao(r.data.descricao);
        setCategoria(r.data.categoria);
        setOficial(r.data.oficial);
      })
      .finally(() => setCarregando(false));
  }, [serverId]);

  function salvar() {
    setErro(null);
    setSalvo(false);
    startTransition(async () => {
      const r = await salvarVitrineAction(serverId, publico, descricao, categoria);
      if (r.ok) setSalvo(true);
      else setErro(r.error);
    });
  }

  if (carregando) {
    return <p className="text-xs text-ink-500">Carregando...</p>;
  }

  return (
    <div className="flex flex-col gap-3 border-t border-base-800 pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[13px] font-semibold text-ink-100">
          Explorar comunidades
        </h4>
        {oficial ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-amber-300">
            <BadgeCheck className="h-3 w-3" strokeWidth={2.5} />
            Oficial
          </span>
        ) : null}
      </div>

      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={publico}
          onChange={(e) => {
            setPublico(e.target.checked);
            setSalvo(false);
          }}
          className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500"
        />
        <span className="min-w-0">
          <span className="block text-[13px] text-ink-100">
            Mostrar este servidor na vitrine
          </span>
          <span className="mt-1 block text-[12px] leading-relaxed text-ink-500">
            Qualquer pessoa com conta vai poder encontrar e entrar sem convite.
            Desligado, o servidor so e acessivel por convite, como antes.
          </span>
        </span>
      </label>

      {publico ? (
        <>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="vitrine-descricao"
              className="text-[11px] font-bold uppercase tracking-wide text-ink-400"
            >
              Descricao
            </label>
            <textarea
              id="vitrine-descricao"
              value={descricao}
              onChange={(e) => {
                setDescricao(e.target.value);
                setSalvo(false);
              }}
              maxLength={160}
              rows={2}
              placeholder="Do que se trata este servidor?"
              className="resize-none rounded-md border border-base-800 bg-base-950 px-2.5 py-2 text-[13px] text-ink-100 placeholder:text-ink-600 focus:border-accent-500 focus:outline-none"
            />
            <span className="self-end text-[10px] text-ink-600">
              {descricao.length}/160
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-ink-400">
              Categoria
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setCategoria(null);
                  setSalvo(false);
                }}
                aria-pressed={categoria === null}
                className={cn(
                  "rounded-full px-3 py-1 text-[12px] transition-colors",
                  categoria === null
                    ? "bg-accent-500 text-white"
                    : "bg-base-850 text-ink-400 hover:bg-base-800",
                )}
              >
                Nenhuma
              </button>
              {CATEGORIAS_DE_COMUNIDADE.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCategoria(c.id);
                    setSalvo(false);
                  }}
                  aria-pressed={categoria === c.id}
                  className={cn(
                    "rounded-full px-3 py-1 text-[12px] transition-colors",
                    categoria === c.id
                      ? "bg-accent-500 text-white"
                      : "bg-base-850 text-ink-400 hover:bg-base-800",
                  )}
                >
                  {c.nome}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {erro ? <p className="text-xs text-signal-dnd">{erro}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={salvar} disabled={pending}>
          {pending ? "Salvando..." : "Salvar"}
        </Button>
        {salvo ? (
          <span className="text-xs text-signal-online">Salvo.</span>
        ) : null}
      </div>
    </div>
  );
}
