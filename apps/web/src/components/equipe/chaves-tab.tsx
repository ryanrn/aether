"use client";

import { useEffect, useState, useTransition } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { PLANS, type PlanTier } from "@aether/shared";
import {
  gerarChaveAction,
  listarChavesAction,
  revogarChaveAction,
  type ChaveGerada,
} from "@/server/actions/chaves";
import type { ChaveNaLista } from "@/server/services/planos";
import { cn } from "@/lib/utils";

/**
 * Gerar e gerenciar chaves de plano, sem sair do painel.
 *
 * SO A EQUIPE VE ESTA ABA — quem decide e o servidor: as tres actions passam
 * por `sessaoDaEquipe()` e respondem "Nao encontrado" para o resto.
 *
 * O CODIGO APARECE UMA VEZ. Depois disso o banco so tem o sha256; a lista
 * embaixo mostra o prefixo ("AE-7F3K…") so para reconhecer a chave.
 */

const TIERS: { valor: Exclude<PlanTier, "FREE">; rotulo: string }[] = [
  { valor: "PLUS", rotulo: PLANS.PLUS.rotulo },
  { valor: "PRO", rotulo: PLANS.PRO.rotulo },
];

const ESTADO_ROTULO: Record<ChaveNaLista["estado"], string> = {
  ativa: "ativa",
  revogada: "revogada",
  vencida: "vencida",
  esgotada: "esgotada",
};

export function ChavesTab() {
  const [tier, setTier] = useState<Exclude<PlanTier, "FREE">>("PRO");
  const [dias, setDias] = useState("30");
  const [usos, setUsos] = useState("1");
  const [validade, setValidade] = useState("");
  const [motivo, setMotivo] = useState("");

  const [erro, setErro] = useState<string | null>(null);
  const [gerada, setGerada] = useState<ChaveGerada | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [gerando, gerarTransition] = useTransition();

  const [lista, setLista] = useState<ChaveNaLista[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(true);

  useEffect(() => {
    void listarChavesAction().then((r) => {
      if (r.ok) setLista(r.data);
      setCarregandoLista(false);
    });
  }, []);

  function gerar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setGerada(null);
    setCopiado(false);
    gerarTransition(async () => {
      const r = await gerarChaveAction({
        tier,
        dias: dias.trim() || null,
        maxUsos: usos.trim() || null,
        validadeDias: validade.trim() || null,
        motivo: motivo.trim() || null,
      });
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      setGerada(r.data);
      setMotivo("");
      const atual = await listarChavesAction();
      if (atual.ok) setLista(atual.data);
    });
  }

  function copiar() {
    if (!gerada) return;
    void navigator.clipboard
      ?.writeText(gerada.codigo)
      .then(() => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      })
      .catch(() => undefined);
  }

  function revogar(id: string) {
    void revogarChaveAction(id).then((r) => {
      if (r.ok) setLista(r.data);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Formulario */}
      <form
        onSubmit={gerar}
        className="rounded-lg border border-line bg-base-800 p-5"
      >
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
          Gerar uma chave
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label>Plano</Label>
            <div className="flex gap-2">
              {TIERS.map((t) => (
                <button
                  key={t.valor}
                  type="button"
                  onClick={() => setTier(t.valor)}
                  aria-pressed={tier === t.valor}
                  className={cn(
                    "flex-1 rounded-sm border px-3 py-2 text-[13px] font-medium transition-colors",
                    tier === t.valor
                      ? "border-accent-line bg-accent-500/12 text-accent-300"
                      : "border-line text-ink-300 hover:bg-base-750 hover:text-ink-100",
                  )}
                >
                  {t.rotulo}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ch-dias">
              Dias de plano{" "}
              <span className="font-normal text-ink-500">
                — vazio = permanente
              </span>
            </Label>
            <Input
              id="ch-dias"
              inputMode="numeric"
              value={dias}
              onChange={(e) => setDias(e.target.value)}
              placeholder="30"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ch-usos">
              Usos{" "}
              <span className="font-normal text-ink-500">— 1 = pessoal</span>
            </Label>
            <Input
              id="ch-usos"
              inputMode="numeric"
              value={usos}
              onChange={(e) => setUsos(e.target.value)}
              placeholder="1"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ch-validade">
              Validade da chave{" "}
              <span className="font-normal text-ink-500">— dias, opcional</span>
            </Label>
            <Input
              id="ch-validade"
              inputMode="numeric"
              value={validade}
              onChange={(e) => setValidade(e.target.value)}
              placeholder="sem prazo"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ch-motivo">
              Motivo{" "}
              <span className="font-normal text-ink-500">— opcional</span>
            </Label>
            <Input
              id="ch-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="sorteio, presente…"
            />
          </div>
        </div>

        {erro ? (
          <p className="mt-3 text-[12px] text-signal-dnd">{erro}</p>
        ) : null}

        <div className="mt-4">
          <Button type="submit" disabled={gerando}>
            {gerando ? (
              <>
                <AetherIcon name="loader" className="h-4 w-4 animate-spin" />
                Gerando…
              </>
            ) : (
              <>
                <AetherIcon name="key" className="h-4 w-4" />
                Gerar chave
              </>
            )}
          </Button>
        </div>
      </form>

      {/* Chave recem-gerada — aparece UMA vez */}
      {gerada ? (
        <div className="rounded-lg border border-accent-line bg-accent-500/[0.06] p-5">
          <p className="flex items-center gap-2 text-[12px] font-semibold text-accent-300">
            <AetherIcon name="check" className="h-4 w-4" />
            Chave criada — {PLANS[gerada.tier].rotulo}
            {gerada.dias ? ` · ${gerada.dias} dias` : " · permanente"}
            {gerada.maxUsos > 1 ? ` · ${gerada.maxUsos} usos` : ""}
          </p>

          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-sm border border-line-strong bg-base-950 px-3 py-2.5 font-mono text-[15px] tracking-wide text-ink-100">
              {gerada.codigo}
            </code>
            <button
              type="button"
              onClick={copiar}
              className="flex shrink-0 items-center gap-1.5 rounded-sm border border-line-strong bg-base-800 px-3 py-2.5 text-[13px] font-medium text-ink-200 transition-colors hover:bg-base-750"
            >
              <AetherIcon
                name={copiado ? "clipboard-check" : "copy"}
                className={cn("h-4 w-4", copiado && "text-accent-300")}
              />
              {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>

          <p className="mt-2.5 text-[12px] leading-snug text-ink-400">
            <strong className="text-warn">Anote agora.</strong> O código não
            aparece de novo — o banco só guarda o hash. Se perder, revogue e
            gere outra.
          </p>
        </div>
      ) : null}

      {/* Lista */}
      <div>
        <h2 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
          Chaves criadas
        </h2>

        {carregandoLista ? (
          <p className="text-[13px] text-ink-500">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="text-[13px] text-ink-500">
            Nenhuma chave criada ainda.
          </p>
        ) : (
          <ul className="flex flex-col rounded-lg border border-line">
            {lista.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft px-4 py-3 first:border-t-0"
              >
                <code className="font-mono text-[13px] text-ink-200">
                  AETHER-{c.prefixo}…
                </code>
                <span className="text-[12px] text-ink-300">
                  {PLANS[c.tier].rotulo}
                </span>
                <span className="text-[12px] text-ink-400">
                  {c.dias ? `${c.dias}d` : "permanente"}
                </span>
                <span className="font-mono text-[12px] tabular-nums text-ink-400">
                  {c.usos}/{c.maxUsos}
                </span>
                <span
                  className={cn(
                    "rounded-xs px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em]",
                    c.estado === "ativa"
                      ? "bg-signal-online/15 text-signal-online"
                      : "bg-base-700 text-ink-400",
                  )}
                >
                  {ESTADO_ROTULO[c.estado]}
                </span>
                {c.motivo ? (
                  <span className="text-[12px] text-ink-500">“{c.motivo}”</span>
                ) : null}
                {c.criadaPor ? (
                  <span className="text-[11px] text-ink-500">
                    por {c.criadaPor}
                  </span>
                ) : null}

                <span className="ml-auto">
                  {c.estado === "ativa" ? (
                    <button
                      type="button"
                      onClick={() => revogar(c.id)}
                      className="rounded-sm border border-signal-dnd/40 px-2 py-1 text-[11px] font-medium text-signal-dnd transition-colors hover:bg-signal-dnd/15"
                    >
                      Revogar
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-[12px] leading-snug text-ink-500">
          Revogar só impede novos resgates — quem já resgatou continua com o
          plano.
        </p>
      </div>
    </div>
  );
}
