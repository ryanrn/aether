"use client";

import { useEffect, useState, useTransition } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { CATEGORIAS_DE_COMUNIDADE, type VitrineStatus } from "@aether/shared";
import {
  lerVitrineAction,
  salvarVitrineAction,
} from "@/server/actions/descoberta";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Pedir para aparecer em "Explorar comunidades".
 *
 * PEDIDO, e nao publicacao. A primeira versao era um interruptor que publicava
 * na hora — e como qualquer pessoa cria conta e servidor, isso abria a vitrine
 * para spam e para alguem criar um servidor chamado "AETHER OFICIAL" e ficar
 * ao lado do nosso.
 *
 * DESLIGAR, ao contrario, vale na hora e nao passa por ninguem: sair da
 * vitrine e direito do dono.
 *
 * O selo OFICIAL aparece aqui como informacao, e nunca como chave: quem marca
 * e a equipe, por script. Selo que o proprio interessado se da nao vale nada.
 */
export function VitrineSection({ serverId }: { serverId: string }) {
  const [carregando, setCarregando] = useState(true);
  const [vitrine, setVitrine] = useState<VitrineStatus>("PRIVADO");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [oficial, setOficial] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  /** O que o interruptor mostra: pedir ou nao aparecer. */
  const quer = vitrine === "PENDENTE" || vitrine === "APROVADO";
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void lerVitrineAction(serverId)
      .then((r) => {
        if (!r.ok) {
          setErro(r.error);
          return;
        }
        setVitrine(r.data.vitrine);
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
      const r = await salvarVitrineAction(serverId, quer, descricao, categoria);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      setVitrine(r.data.status);
      setSalvo(true);
      if (r.data.voltouParaFila) {
        setAviso(
          "Como o servidor esta listado e a descricao mudou, ele voltou para " +
            "analise. Ele sai da vitrine ate ser revisto.",
        );
      } else {
        setAviso(null);
      }
    });
  }

  if (carregando) {
    return <p className="text-xs text-ink-500">Carregando...</p>;
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[13px] font-semibold text-ink-100">
          Explorar comunidades
        </h4>
        {oficial ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-amber-300">
            <AetherIcon
              name="badge-check"
              className="h-3 w-3"
              strokeWidth={2.5}
            />
            Oficial
          </span>
        ) : null}
      </div>

      <EstadoDaVitrine status={vitrine} />

      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={quer}
          onChange={(e) => {
            /*
             * Marcar aqui e um PEDIDO, e nao a publicacao. O servidor so entra
             * na vitrine depois de a equipe olhar — sem isso, qualquer conta
             * nova se listaria sozinha, e a vitrine viraria o lugar mais facil
             * de se passar por um servidor oficial.
             */
            setVitrine(e.target.checked ? "PENDENTE" : "PRIVADO");
            setSalvo(false);
            setAviso(null);
          }}
          className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500"
        />
        <span className="min-w-0">
          <span className="block text-[13px] text-ink-100">
            Pedir para aparecer na vitrine
          </span>
          <span className="mt-1 block text-[12px] leading-relaxed text-ink-500">
            Um pedido passa por analise antes de entrar. Aprovado, qualquer
            pessoa com conta encontra e entra sem convite. Desligando, ele sai
            da vitrine na hora — isso nao precisa de analise.
          </span>
        </span>
      </label>

      {quer ? (
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
              className="resize-none rounded-md border border-line bg-base-950 px-2.5 py-2 text-[13px] text-ink-100 placeholder:text-ink-600 focus:border-accent-500 focus:outline-none"
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

      {aviso ? (
        <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-2 text-[12px] leading-relaxed text-amber-200">
          {aviso}
        </p>
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

/** O que esta acontecendo com o pedido, em uma linha. */
function EstadoDaVitrine({ status }: { status: VitrineStatus }) {
  if (status === "PRIVADO") return null;

  const texto: Record<Exclude<VitrineStatus, "PRIVADO">, string> = {
    PENDENTE: "Em analise. Ele ainda nao aparece na vitrine.",
    APROVADO: "Aprovado. Ele esta na vitrine.",
    RECUSADO:
      "Recusado. Corrija o que puder e peca de novo — recusa nao e definitiva.",
  };

  const cor: Record<Exclude<VitrineStatus, "PRIVADO">, string> = {
    PENDENTE: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    APROVADO: "border-signal-online/30 bg-signal-online/10 text-signal-online",
    RECUSADO: "border-signal-dnd/30 bg-signal-dnd/10 text-signal-dnd",
  };

  return (
    <p className={`rounded-md border px-2.5 py-2 text-[12px] ${cor[status]}`}>
      {texto[status]}
    </p>
  );
}
