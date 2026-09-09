"use client";

import { useEffect } from "react";
import { hidratarPrefsDoChat, LIMITES, usePrefsDoChat } from "@/lib/chat/prefs";
import { ToggleRow } from "@/components/ui/switch";

/**
 * Acessibilidade — o que vale para o APP INTEIRO, nao so o chat.
 *
 * A escala aplica `zoom` no `<html>`, entao a interface inteira cresce junto.
 * Tambem responde a Ctrl +/- / Ctrl 0 (ver `AparenciaProvider`). Contraste e
 * movimento viram `data-*` no `<html>`, lidos por `globals.css`. Tudo persiste
 * no `localStorage`, aplicado sem flash pelo script do layout raiz.
 */
export function AcessibilidadeTab() {
  const prefs = usePrefsDoChat();
  useEffect(() => hidratarPrefsDoChat(), []);

  const escalaPct = Math.round(prefs.escalaInterface * 100);

  return (
    <section className="flex flex-col gap-7">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500">
          Escala da interface
        </h3>
        <div className="mt-3 rounded-md border border-line bg-base-900 px-3 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-ink-200">
              Tamanho de tudo na tela
            </span>
            <span className="font-mono text-[11px] tabular-nums text-ink-400">
              {escalaPct}%
            </span>
          </div>
          <input
            type="range"
            min={Math.round(LIMITES.escalaInterface[0] * 100)}
            max={Math.round(LIMITES.escalaInterface[1] * 100)}
            step={5}
            value={escalaPct}
            onChange={(e) =>
              prefs.definir("escalaInterface", Number(e.target.value) / 100)
            }
            aria-label="Escala da interface"
            className="mt-2 block w-full accent-accent-500"
          />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-600">
            <span>80%</span>
            <span>100%</span>
            <span>150%</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
            Aumenta ou diminui a interface inteira, como o zoom do navegador.
            Atalho:{" "}
            <kbd className="rounded border border-line bg-base-800 px-1 font-mono text-[10px] text-ink-300">
              Ctrl
            </kbd>{" "}
            com{" "}
            <kbd className="rounded border border-line bg-base-800 px-1 font-mono text-[10px] text-ink-300">
              +
            </kbd>
            ,{" "}
            <kbd className="rounded border border-line bg-base-800 px-1 font-mono text-[10px] text-ink-300">
              -
            </kbd>{" "}
            ou{" "}
            <kbd className="rounded border border-line bg-base-800 px-1 font-mono text-[10px] text-ink-300">
              0
            </kbd>{" "}
            para voltar a 100%. Para mexer so no texto do chat, use a fonte na
            aba Aparencia.
          </p>
        </div>
      </div>

      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500">
          Leitura
        </h3>
        <div className="mt-1 flex flex-col">
          <ToggleRow
            checked={prefs.contrasteAlto}
            onCheckedChange={(v) => prefs.definir("contrasteAlto", v)}
            title="Contraste aumentado"
            description="Texto mais claro e bordas mais visiveis em toda a interface."
          />
          <ToggleRow
            checked={prefs.legibilidade}
            onCheckedChange={(v) => prefs.definir("legibilidade", v)}
            title="Melhorar legibilidade do chat"
            description="Linhas mais soltas, letra um pouco mais encorpada no corpo das mensagens."
          />
        </div>
      </div>

      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500">
          Movimento
        </h3>
        <div className="mt-1 flex flex-col">
          <ToggleRow
            checked={prefs.reduzirMovimento}
            onCheckedChange={(v) => prefs.definir("reduzirMovimento", v)}
            title="Reduzir movimento"
            description="Corta transicoes e deslocamentos quase por completo, como a opcao do sistema."
          />
          <ToggleRow
            checked={prefs.reduzirAnimacoes}
            onCheckedChange={(v) => prefs.definir("reduzirAnimacoes", v)}
            title="Reduzir animacoes de ambiente"
            description="Para o brilho pulsante de quem fala, medidores e outros efeitos continuos. Mantem as transicoes de hover."
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => prefs.restaurar()}
        className="self-start text-[12px] text-ink-400 underline-offset-2 hover:text-ink-200 hover:underline"
      >
        Restaurar o padrao
      </button>
    </section>
  );
}
