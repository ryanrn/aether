"use client";

import { useState, useTransition } from "react";
import { Check, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resgatarChaveAction, type PlanoNaTela } from "@/server/actions/planos";
import { cn } from "@/lib/utils";

/**
 * O campo de resgatar chave.
 *
 * UM SO, usado na aba de configuracoes e na pagina do Olimpo. Duas copias
 * divergiriam na primeira mensagem de erro que alguem ajustasse — e sao
 * justamente as mensagens de recusa que a pessoa le quando algo deu errado.
 *
 * ENQUANTO NAO HA COBRANCA, este e o unico caminho que de fato entrega plano.
 * Por isso ele aparece na pagina de venda tambem, e nao so escondido nas
 * configuracoes: mandar quem tem uma chave procurar em outro lugar seria
 * esconder a unica porta que abre.
 */
export function ResgatarChave({
  onResgatado,
  className,
}: {
  onResgatado?: (plano: PlanoNaTela) => void;
  className?: string;
}) {
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);
  const [enviando, iniciar] = useTransition();

  function resgatar() {
    if (!codigo.trim() || enviando) return;
    setErro(null);
    setPronto(false);
    iniciar(async () => {
      const r = await resgatarChaveAction(codigo);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      setCodigo("");
      setPronto(true);
      onResgatado?.(r.data);
    });
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-base-700 bg-base-950 px-3 py-2 focus-within:border-amber-400/50">
          <KeyRound className="h-3.5 w-3.5 shrink-0 text-ink-500" />
          <input
            value={codigo}
            onChange={(e) => {
              setCodigo(e.target.value);
              setErro(null);
              setPronto(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") resgatar();
            }}
            placeholder="AETHER-XXXX-XXXX-XXXX"
            aria-label="Código da chave"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent font-mono text-[13px] uppercase text-ink-100 outline-none placeholder:font-sans placeholder:normal-case placeholder:text-ink-500"
          />
        </div>
        <Button onClick={resgatar} disabled={enviando || !codigo.trim()}>
          {enviando ? "Resgatando..." : "Resgatar"}
        </Button>
      </div>

      {erro ? <p className="mt-2 text-[12px] text-signal-dnd">{erro}</p> : null}
      {pronto ? (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-signal-online">
          <Check className="h-3.5 w-3.5" />
          Pronto — seu plano foi atualizado.
        </p>
      ) : null}
    </div>
  );
}
