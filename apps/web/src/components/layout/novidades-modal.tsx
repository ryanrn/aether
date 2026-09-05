"use client";

import { useEffect, useState } from "react";
import {
  AetherIcon,
  type AetherIconName,
} from "@/components/ui/aether-icon";
import { Modal } from "@/components/ui/modal";
import { estadoDaAtualizacao, podeAtualizar } from "@/lib/desktop/update";
import {
  marcarComoVista,
  novidadesParaMostrar,
  type CategoriaDeNovidade,
  type NovidadesDaVersao,
} from "@/lib/novidades";

/**
 * "Veja o que mudou" — primeiro boot depois de uma atualizacao.
 *
 * POR QUE DEPOIS, e nao antes de clicar em Atualizar: clicar em Atualizar
 * FECHA o app para instalar. Uma tela mostrada ali duraria o tempo do
 * clique. Aqui ela aparece quando a pessoa reabre na versao nova — que e o
 * momento em que "o que mudou?" e uma pergunta de verdade.
 *
 * So no aplicativo de desktop: no navegador nao existe versao instalada com
 * que comparar (cada deploy ja chega sozinho, sem ninguem atualizar nada).
 *
 * Nao aparece para quem acabou de instalar pela primeira vez — ver a regra em
 * `lib/novidades.ts`.
 */

/** Cada categoria tem seu icone do sprite do Aether. */
const ICONE: Record<CategoriaDeNovidade, AetherIconName> = {
  recurso: "sparkle",
  performance: "zap",
  correcao: "bug",
  seguranca: "shield-check",
};

const ROTULO: Record<CategoriaDeNovidade, string> = {
  recurso: "Novo recurso",
  performance: "Performance",
  correcao: "Correcoes",
  seguranca: "Seguranca",
};

export function NovidadesModal() {
  const [novidades, setNovidades] = useState<NovidadesDaVersao | null>(null);

  useEffect(() => {
    if (!podeAtualizar()) return;
    let cancelado = false;

    /**
     * A versao vem do `versaoAtual` que o `desktop:atualizacao-estado` ja
     * devolve — nao ha IPC novo. Se a ponte falhar, nao mostramos nada: e
     * melhor perder o aviso do que abrir um modal com versao errada.
     */
    void estadoDaAtualizacao().then((estado) => {
      const versao = estado?.versaoAtual;
      if (cancelado || !versao) return;
      setNovidades(novidadesParaMostrar(versao));
    });

    return () => {
      cancelado = true;
    };
  }, []);

  function fechar() {
    if (novidades) marcarComoVista(novidades.versao);
    setNovidades(null);
  }

  if (!novidades) return null;

  return (
    <Modal
      open
      onClose={fechar}
      title={`Novidades da versao ${novidades.versao}`}
      bare
      className="w-[min(480px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-[22px] bg-base-850/95 backdrop-blur-2xl"
    >
      <div className="p-6 sm:p-9">
        {/* Assinatura do Aether: hairline em gradiente. */}
        <div
          aria-hidden
          className="mb-6 h-px w-14 bg-gradient-to-r from-transparent via-accent-600 to-transparent"
        />

        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-400/40 bg-accent-400/10 px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide text-accent-300">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-400 shadow-[0_0_8px_1px_rgba(94,160,255,0.75)]" />
            v{novidades.versao}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-500">
            Atualizado · {formatarData(novidades.data)}
          </span>
        </div>

        <h2 className="mt-5 font-brand text-[33px] font-bold leading-[1.05] tracking-[-0.01em] text-ink-100 sm:text-[40px]">
          Veja o que mudou.
        </h2>

        <p className="mt-3 max-w-[44ch] text-[14px] leading-relaxed text-ink-400">
          {novidades.resumo}
        </p>

        <ul className="mt-7 max-h-[42vh] space-y-2 overflow-y-auto">
          {novidades.itens.map((item, i) => (
            <li
              key={i}
              className="group flex items-start gap-4 rounded-[14px] border border-line bg-base-900/50 p-4 transition-colors duration-200 hover:border-line-strong hover:bg-base-800/70"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-line bg-base-800 text-accent-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-shadow duration-200 group-hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_0_18px_-6px_#2f88ff]">
                <AetherIcon
                  name={ICONE[item.categoria]}
                  className="h-[18px] w-[18px]"
                />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-accent-300/90">
                  {ROTULO[item.categoria]}
                </p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-200">
                  {item.texto}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={fechar}
          autoFocus
          className="group mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-accent-500 text-[14px] font-medium text-white shadow-[0_0_30px_-10px_#2f88ff] transition-[background-color,box-shadow,transform] duration-200 hover:bg-accent-400 hover:shadow-[0_0_40px_-8px_#2f88ff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400 active:translate-y-px active:bg-accent-600"
        >
          Continuar
          <AetherIcon
            name="arrow-left"
            className="h-4 w-4 rotate-180 transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </button>
      </div>
    </Modal>
  );
}

/** `2026-09-05` -> `5 set 2026`. Sem biblioteca de data para uma linha. */
function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  const meses = [
    "jan", "fev", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "out", "nov", "dez",
  ];
  const nome = meses[Number(mes) - 1];
  if (!ano || !dia || !nome) return iso;
  return `${Number(dia)} ${nome} ${ano}`;
}

