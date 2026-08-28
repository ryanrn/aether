"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { SeloPlano } from "@/components/ui/selo-plano";
import { ResgatarChave } from "@/components/premium/resgatar-chave";
import { PLANS, type PlanTier } from "@aether/shared";
import { meuPlano, type PlanoNaTela } from "@/server/actions/planos";
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

  useEffect(() => {
    void (async () => {
      const r = await meuPlano();
      if (r.ok) setPlano(r.data);
      setCarregando(false);
    })();
  }, []);

  if (carregando) {
    return (
      <div className="flex items-center gap-2 py-8 text-[13px] text-ink-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando seu plano...
      </div>
    );
  }

  const atual = plano?.tier ?? "FREE";

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

        <div className="mt-3">
          <ResgatarChave onResgatado={(novo) => setPlano(novo)} />
        </div>

        {/*
          O caminho para a pagina inteira. Esta aba responde "o que eu tenho";
          a pagina responde "o que existe" — sao perguntas diferentes, e
          duplicar a segunda aqui faria as duas divergirem.
        */}
        <Link
          href="/app/vip"
          className="mt-4 inline-block text-[12px] text-accent-300 hover:text-accent-200"
        >
          Ver todos os planos
        </Link>
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
