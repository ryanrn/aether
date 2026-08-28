"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SeloPlano } from "@/components/ui/selo-plano";
import { PLANS, type PlanTier } from "@aether/shared";
import {
  meuPlano,
  resgatarChaveAction,
  type PlanoNaTela,
} from "@/server/actions/planos";
import { cn } from "@/lib/utils";

/**
 * A aba do plano: o que voce tem, ate quando, e onde resgatar uma chave.
 *
 * Responde a pergunta mais basica de quem paga — "eu tenho mesmo?" — sem
 * depender de ninguem. Sem esta tela, a unica forma de a pessoa saber seria
 * tentar usar um recurso e ver se funciona, o que e uma resposta terrivel para
 * quem pagou.
 *
 * A TELA NAO DECIDE NADA. Ela mostra o que a action devolveu, e a action leu do
 * `@aether/access`. O que aparece aqui e informacao, nunca autorizacao — quem
 * barra e o servidor, em cada uso.
 */
export function PlanoTab() {
  const [plano, setPlano] = useState<PlanoNaTela | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [resgatado, setResgatado] = useState(false);
  const [enviando, iniciar] = useTransition();

  useEffect(() => {
    void (async () => {
      const r = await meuPlano();
      if (r.ok) setPlano(r.data);
      setCarregando(false);
    })();
  }, []);

  function resgatar() {
    if (!codigo.trim() || enviando) return;
    setErro(null);
    setResgatado(false);
    iniciar(async () => {
      const r = await resgatarChaveAction(codigo);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      setPlano(r.data);
      setCodigo("");
      setResgatado(true);
    });
  }

  if (carregando) {
    return (
      <div className="flex items-center gap-2 py-8 text-[13px] text-ink-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando seu plano...
      </div>
    );
  }

  const atual = plano?.tier ?? "FREE";
  const limites = PLANS[atual];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-medium text-ink-100">Seu plano</h3>
          <SeloPlano tier={atual} />
        </div>

        <p className="mt-1 text-[12px] leading-relaxed text-ink-400">
          {atual === "FREE"
            ? "Voce esta no plano gratuito."
            : plano?.expiraEm
              ? `Ativo ate ${formatarData(plano.expiraEm)}.`
              : "Ativo, sem data para acabar."}
        </p>
      </div>

      {/*
        A COMPARACAO INTEIRA, e nao so o que voce tem.
        Quem esta no gratuito precisa ver o que ganha ao assinar, e quem ja
        assina precisa ver o que ainda nao tem. Mostrar so o plano atual
        transformaria esta tela num recibo.
      */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-base-800 text-left">
              <th className="py-2 pr-3 font-medium text-ink-400"> </th>
              {(["FREE", "PLUS", "PRO"] as PlanTier[]).map((t) => (
                <th
                  key={t}
                  className={cn(
                    "px-3 py-2 font-bold",
                    t === atual ? "text-ink-100" : "text-ink-400",
                  )}
                >
                  {PLANS[t].rotulo}
                  {t === atual ? (
                    <span className="ml-1 font-normal text-accent-300">
                      (seu)
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-ink-300">
            <Linha
              rotulo="Tela"
              atual={atual}
              valores={(t) => `${PLANS[t].alturaMax}p ${PLANS[t].quadrosMax}fps`}
            />
            <Linha
              rotulo="Bitrate"
              atual={atual}
              valores={(t) =>
                `${(PLANS[t].bitrateMax / 1_000_000).toLocaleString("pt-BR")} Mbps`
              }
            />
            <Linha
              rotulo="Telas ao mesmo tempo"
              atual={atual}
              valores={(t) => String(PLANS[t].telasSimultaneas)}
            />
            <Linha
              rotulo="Envio de arquivo"
              atual={atual}
              valores={(t) => formatarBytes(PLANS[t].uploadMaxBytes)}
            />
          </tbody>
        </table>
      </div>

      {/*
        O AVISO E OBRIGATORIO enquanto nada estiver trancado.
        Mostrar a tabela sem ele daria a entender que os limites ja valem — e
        cobrar por isso seria vender o que nao existe.
      */}
      <p className="rounded-md border border-base-750 bg-base-900 px-3 py-2.5 text-[11px] leading-relaxed text-ink-400">
        <strong className="text-ink-300">Em construcao.</strong> Os limites
        acima ainda nao sao aplicados — todo mundo transmite e envia igual hoje.
        A tabela mostra para onde vai, e o plano ja fica registrado na sua
        conta.
      </p>

      <div className="border-t border-base-800 pt-5">
        <h3 className="text-[13px] font-medium text-ink-100">
          Resgatar uma chave
        </h3>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-400">
          Recebeu um codigo? Cole aqui. Os dias somam ao que voce ja tem, e uma
          chave menor nunca rebaixa o seu plano.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-base-700 bg-base-950 px-3 py-2 focus-within:border-accent-600/60">
            <KeyRound className="h-3.5 w-3.5 shrink-0 text-ink-500" />
            <input
              value={codigo}
              onChange={(e) => {
                setCodigo(e.target.value);
                setErro(null);
                setResgatado(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") resgatar();
              }}
              placeholder="AETHER-XXXX-XXXX-XXXX"
              aria-label="Codigo da chave"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent font-mono text-[13px] uppercase text-ink-100 outline-none placeholder:normal-case placeholder:font-sans placeholder:text-ink-500"
            />
          </div>
          <Button onClick={resgatar} disabled={enviando || !codigo.trim()}>
            {enviando ? "Resgatando..." : "Resgatar"}
          </Button>
        </div>

        {erro ? (
          <p className="mt-2 text-[12px] text-signal-dnd">{erro}</p>
        ) : null}
        {resgatado ? (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-signal-online">
            <Check className="h-3.5 w-3.5" />
            Pronto — seu plano foi atualizado.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Linha({
  rotulo,
  atual,
  valores,
}: {
  rotulo: string;
  atual: PlanTier;
  valores: (t: PlanTier) => string;
}) {
  return (
    <tr className="border-b border-base-800/60">
      <td className="py-2 pr-3 text-ink-400">{rotulo}</td>
      {(["FREE", "PLUS", "PRO"] as PlanTier[]).map((t) => (
        <td
          key={t}
          className={cn("px-3 py-2", t === atual && "font-medium text-ink-100")}
        >
          {valores(t)}
        </td>
      ))}
    </tr>
  );
}

/** Data no fuso de quem le, sem hora: a hora exata do vencimento nao ajuda. */
function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatarBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${Math.round(mb / 1024)} GB` : `${Math.round(mb)} MB`;
}
