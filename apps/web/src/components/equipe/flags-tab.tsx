"use client";

import { useEffect, useState, useTransition } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { SwitchVisual } from "@/components/ui/switch";
import { SkeletonRows } from "@/components/ui/skeleton";
import {
  listarFlagsAction,
  virarFlagAction,
} from "@/server/actions/flags";
import type { FlagParaAdmin } from "@aether/shared";
import { cn } from "@/lib/utils";

/**
 * Kill switches. So a equipe ve — as duas actions passam por
 * `sessaoDaEquipe()` e respondem "Nao encontrado" para o resto.
 *
 * O QUE ESTA TELA COMUNICA: nao e "config", e "o que esta desviado do
 * normal". Uma chave cujo estado difere do padrao ganha destaque — e um freio
 * puxado, e quem abre o painel precisa ver isso na hora.
 *
 * A propagacao nao e instantanea: cada processo que le a flag tem um cache de
 * ~5s. O aviso no rodape diz isso.
 */
export function FlagsTab() {
  const [flags, setFlags] = useState<FlagParaAdmin[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();
  const [virandoChave, setVirandoChave] = useState<string | null>(null);

  useEffect(() => {
    void listarFlagsAction().then((r) => {
      if (r.ok) setFlags(r.data);
      else setErro(r.error);
    });
  }, []);

  function virar(flag: FlagParaAdmin) {
    setErro(null);
    setVirandoChave(flag.chave);
    startTransition(async () => {
      const r = await virarFlagAction(flag.chave, !flag.ligado);
      setVirandoChave(null);
      if (r.ok) setFlags(r.data);
      else setErro(r.error);
    });
  }

  if (erro && !flags) {
    return <p className="text-[13px] text-signal-dnd">{erro}</p>;
  }
  if (!flags) {
    return <SkeletonRows count={5} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-snug text-ink-400">
        Freios de emergência. Viram o recurso para desligado durante um
        incidente, sem deploy. Não é configuração de produto.
      </p>

      <ul className="flex flex-col rounded-lg border border-line">
        {flags.map((flag) => {
          const desviado = flag.ligado !== flag.padrao;
          const ocupado = pendente && virandoChave === flag.chave;
          return (
            <li
              key={flag.chave}
              className={cn(
                "grid grid-cols-[1fr_auto] items-start gap-4 border-t border-line-soft px-4 py-3.5 first:border-t-0",
                desviado && "bg-amber-400/[0.06]",
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-ink-100">
                    {flag.rotulo}
                  </span>
                  {desviado ? (
                    <span className="flex items-center gap-1 rounded-xs bg-amber-400/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] text-amber-300">
                      <AetherIcon name="alert" className="h-3 w-3" />
                      {flag.ligado ? "ligado à força" : "freio puxado"}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[12px] leading-snug text-ink-400">
                  {flag.descricao}
                </p>
                <p className="mt-1 font-mono text-[11px] text-ink-500">
                  {flag.chave} · padrão {flag.padrao ? "ligado" : "desligado"}
                  {flag.personalizada && flag.atualizadoPor
                    ? ` · mexido por ${flag.atualizadoPor}`
                    : ""}
                </p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={flag.ligado}
                aria-label={flag.rotulo}
                disabled={ocupado}
                onClick={() => virar(flag)}
                className="rounded-pill pt-0.5 transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent-500 disabled:cursor-not-allowed active:scale-95"
              >
                <SwitchVisual checked={flag.ligado} disabled={ocupado} />
              </button>
            </li>
          );
        })}
      </ul>

      {erro ? <p className="text-[12px] text-signal-dnd">{erro}</p> : null}

      <p className="text-[12px] leading-snug text-ink-500">
        A mudança leva até ~5s para valer em cada processo (web e gateway têm
        cache curto). O rastro de quem virou o quê fica no log estruturado
        (<code className="font-mono">flag.alterada</code>).
      </p>
    </div>
  );
}
