"use client";

import { useEffect, useState, useTransition } from "react";
import {
  CONCESSAO_MAXIMA,
  formatarMoedas,
  MOEDA,
  type MissaoNoPainel,
} from "@aether/shared";
import { AetherIcon } from "@/components/ui/aether-icon";
import { SwitchVisual } from "@/components/ui/switch";
import { SkeletonRows } from "@/components/ui/skeleton";
import { concederMoedasAction } from "@/server/actions/moedas";
import { ajustarMissaoAction, catalogoDeMissoesAction } from "@/server/actions/missoes";
import { cn } from "@/lib/utils";

/**
 * Dar ou tirar moedas de alguem: premio de evento, correcao de erro, teste.
 *
 * Valor negativo tira; tirar mais do que a pessoa tem e recusado inteiro (o
 * saldo nunca fica negativo). Cada envio vira uma linha no extrato da pessoa
 * e uma entrada na auditoria global, com quem enviou e a nota.
 */
export function MoedasTab() {
  return (
    <div className="grid gap-10">
      <section className="grid gap-3">
        <h2 className="text-[14px] font-semibold text-ink-100">Enviar {MOEDA.plural}</h2>
        <EnviarMoedas />
      </section>
      <section className="grid gap-3">
        <h2 className="text-[14px] font-semibold text-ink-100">Missões</h2>
        <MissoesDoPainel />
      </section>
    </div>
  );
}

function EnviarMoedas() {
  const [username, setUsername] = useState("");
  const [valor, setValor] = useState("");
  const [nota, setNota] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setFeito(null);
    const n = Number(valor);
    startTransition(async () => {
      const r = await concederMoedasAction(username, n, nota);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      setFeito(
        `${n > 0 ? "Enviado" : "Retirado"}: ${formatarMoedas(n)} para @${username.trim()}. Saldo agora: ${formatarMoedas(r.data.saldo)}.`,
      );
      setValor("");
      setNota("");
    });
  }

  const campo =
    "h-10 w-full rounded-md border border-line bg-base-900 px-3 text-[13px] text-ink-100 outline-none placeholder:text-ink-500 focus:border-accent-500";

  return (
    <form onSubmit={enviar} className="grid max-w-md gap-4">
      <p className="text-[13px] leading-relaxed text-ink-400">
        Envie {MOEDA.plural} para alguém (prêmio, correção, teste). Use um valor
        negativo para retirar. Tudo fica no extrato da pessoa e na auditoria
        global.
      </p>

      <label className="grid gap-1.5">
        <span className="text-[12px] font-medium text-ink-300">Usuário</span>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="nomedeusuario"
          autoComplete="off"
          className={campo}
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-[12px] font-medium text-ink-300">
          Valor (até {CONCESSAO_MAXIMA.toLocaleString("pt-BR")}, negativo retira)
        </span>
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value.replace(/[^\d-]/g, ""))}
          inputMode="numeric"
          placeholder="500"
          className={campo}
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-[12px] font-medium text-ink-300">
          Nota (aparece no extrato da pessoa)
        </span>
        <input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          maxLength={200}
          placeholder="Prêmio do evento de sábado"
          className={campo}
        />
      </label>

      <button
        type="submit"
        disabled={pendente || !username.trim() || !valor || valor === "-"}
        className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-accent-500 px-4 text-[13px] font-bold text-[#04122b] transition-colors hover:bg-accent-400 disabled:opacity-50"
      >
        <AetherIcon name="sparkle" className="h-4 w-4" />
        {pendente ? "Enviando…" : "Enviar"}
      </button>

      {erro ? <p className="text-[13px] text-signal-dnd">{erro}</p> : null}
      {feito ? <p className="text-[13px] text-signal-online">{feito}</p> : null}
    </form>
  );
}

const METRICA_LABEL: Record<MissaoNoPainel["metrica"], string> = {
  MINUTOS_EM_VOZ: "minutos em voz",
  MINUTOS_JOGANDO: "minutos jogando",
  DIAS_ATIVOS: "dias ativos",
};

/**
 * O catalogo de missoes: ajustar meta e recompensa, ligar e desligar. Mudanca
 * vale na hora (o gateway relê o catalogo em ate 5 minutos para CONTAR; o
 * resgate ja usa o valor novo). Toda mudanca entra na auditoria global.
 */
function MissoesDoPainel() {
  const [missoes, setMissoes] = useState<MissaoNoPainel[] | null>(null);
  const [rascunho, setRascunho] = useState<Record<string, { meta: string; recompensa: string }>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    void catalogoDeMissoesAction().then((r) => {
      if (r.ok) setMissoes(r.data);
      else setErro(r.error);
    });
  }, []);

  function salvar(id: string, dados: { meta?: string; recompensa?: string; ativa?: boolean }) {
    setErro(null);
    setOcupada(id);
    startTransition(async () => {
      const r = await ajustarMissaoAction(id, dados);
      setOcupada(null);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      setMissoes(r.data);
      setRascunho((d) => {
        const { [id]: _salvo, ...resto } = d;
        return resto;
      });
    });
  }

  if (!missoes) {
    return erro ? <p className="text-[13px] text-signal-dnd">{erro}</p> : <SkeletonRows count={4} />;
  }

  const campo =
    "h-8 w-20 rounded-md border border-line bg-base-900 px-2 text-right font-mono text-[12.5px] text-ink-100 outline-none focus:border-accent-500";

  return (
    <div className="grid gap-2">
      {erro ? <p className="text-[13px] text-signal-dnd">{erro}</p> : null}
      <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line">
        {missoes.map((m) => {
          const r = rascunho[m.id] ?? { meta: String(m.meta), recompensa: String(m.recompensa) };
          const mudou = r.meta !== String(m.meta) || r.recompensa !== String(m.recompensa);
          const editar = (k: "meta" | "recompensa", v: string) =>
            setRascunho((d) => ({ ...d, [m.id]: { ...r, [k]: v.replace(/[^\d]/g, "") } }));
          return (
            <li key={m.id} className="grid gap-2 bg-base-900 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={cn("text-[13px] font-medium", m.ativa ? "text-ink-100" : "text-ink-500")}>
                    {m.titulo}
                  </p>
                  <p className="text-[11.5px] text-ink-500">
                    {m.periodo === "DIARIA" ? "Diária" : "Semanal"} · {METRICA_LABEL[m.metrica]}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={ocupada === m.id}
                  onClick={() => salvar(m.id, { ativa: !m.ativa })}
                  aria-label={m.ativa ? `Desligar ${m.titulo}` : `Ligar ${m.titulo}`}
                >
                  <SwitchVisual checked={m.ativa} disabled={ocupada === m.id} />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[12px] text-ink-400">
                <label className="flex items-center gap-1.5">
                  Meta
                  <input value={r.meta} onChange={(e) => editar("meta", e.target.value)} className={campo} inputMode="numeric" />
                </label>
                <label className="flex items-center gap-1.5">
                  Recompensa
                  <input value={r.recompensa} onChange={(e) => editar("recompensa", e.target.value)} className={campo} inputMode="numeric" />
                </label>
                {mudou ? (
                  <button
                    type="button"
                    disabled={ocupada === m.id}
                    onClick={() => salvar(m.id, { meta: r.meta, recompensa: r.recompensa })}
                    className="h-8 rounded-md bg-accent-500 px-3 text-[12px] font-bold text-[#04122b] hover:bg-accent-400 disabled:opacity-60"
                  >
                    Salvar
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
