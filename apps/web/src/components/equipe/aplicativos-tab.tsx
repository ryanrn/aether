"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/field";
import { SkeletonRows } from "@/components/ui/skeleton";
import {
  definirAplicacaoBloqueadaAction,
  listarAplicacoesParaEquipeAction,
} from "@/server/actions/aplicativos-equipe";
import type { AppNoPainelDaEquipe } from "@/server/services/aplicativos";
import { cn } from "@/lib/utils";

/**
 * Kill switch de aplicacao (bot) abusiva.
 *
 * `Application.blockedAt` ja e imposto em tres lugares (token de bot, gateway
 * de bot, resolucao de instalacao) desde que a Developer Platform existe —
 * mas nao havia NENHUMA tela pra ligar. So dava pra bloquear mexendo direto
 * no banco. So a equipe ve: `sessaoDaEquipe()` nas duas actions, "Nao
 * encontrado" pro resto.
 */
export function AplicativosTab() {
  const [itens, setItens] = useState<AppNoPainelDaEquipe[] | null>(null);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [agindoEm, setAgindoEm] = useState<string | null>(null);
  const [confirmandoBloquear, setConfirmandoBloquear] =
    useState<AppNoPainelDaEquipe | null>(null);

  const carregar = useCallback((termo?: string) => {
    void listarAplicacoesParaEquipeAction(termo).then((r) => {
      if (r.ok) setItens(r.data);
      else setErro(r.error);
    });
  }, []);

  useEffect(() => carregar(), [carregar]);

  function buscar(evento: React.FormEvent) {
    evento.preventDefault();
    carregar(busca.trim() || undefined);
  }

  function alternarBloqueio(app: AppNoPainelDaEquipe, bloquear: boolean) {
    setErro(null);
    setAgindoEm(app.id);
    startTransition(async () => {
      const r = await definirAplicacaoBloqueadaAction(app.id, bloquear);
      setAgindoEm(null);
      if (r.ok) {
        setConfirmandoBloquear(null);
        carregar(busca.trim() || undefined);
      } else {
        setErro(r.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={buscar} className="flex gap-2">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Nome ou id da aplicação..."
          className="max-w-[320px]"
        />
        <button
          type="submit"
          className="rounded-md border border-line-strong bg-base-800 px-3 text-[13px] text-ink-200 transition-colors hover:bg-base-750"
        >
          Buscar
        </button>
      </form>

      {erro ? <p className="text-[12px] text-signal-dnd">{erro}</p> : null}

      {itens === null ? (
        <SkeletonRows count={3} />
      ) : itens.length === 0 ? (
        <p className="text-[13px] text-ink-500">Nenhuma aplicação encontrada.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {itens.map((app) => {
            const ocupado = pending && agindoEm === app.id;
            return (
              <li
                key={app.id}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-lg border border-line bg-base-800 px-3.5 py-2.5",
                  app.bloqueada && "border-signal-dnd/40 bg-signal-dnd/[0.04]",
                )}
              >
                <span className="font-medium text-ink-100">{app.name}</span>
                <span className="font-mono text-[11px] text-ink-500">
                  {app.id}
                </span>
                <span className="text-[12px] text-ink-400">
                  por {app.ownerUsername ? `@${app.ownerUsername}` : "conta removida"}
                </span>
                <span className="text-[12px] text-ink-500">
                  {app.instalacoes} instalação(ões)
                </span>
                {app.botHabilitado ? (
                  <span className="rounded-xs bg-base-700 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] text-ink-300">
                    bot
                  </span>
                ) : null}
                {app.bloqueada ? (
                  <span className="flex items-center gap-1 rounded-xs bg-signal-dnd/15 px-1.5 py-0.5 text-[11px] font-medium text-signal-dnd">
                    <AetherIcon name="lock" className="h-3 w-3" />
                    Bloqueada
                  </span>
                ) : null}

                <span className="ml-auto">
                  {app.bloqueada ? (
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => alternarBloqueio(app, false)}
                      className="rounded-sm border border-line-strong px-2 py-1 text-[11px] font-medium text-ink-200 transition-colors hover:bg-base-750 disabled:opacity-50"
                    >
                      {ocupado ? "Desbloqueando..." : "Desbloquear"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => setConfirmandoBloquear(app)}
                      className="rounded-sm border border-signal-dnd/40 px-2 py-1 text-[11px] font-medium text-signal-dnd transition-colors hover:bg-signal-dnd/15 disabled:opacity-50"
                    >
                      Bloquear
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[12px] leading-snug text-ink-500">
        Bloquear derruba todos os tokens da aplicação na hora (a REST v1 e o
        Bot Gateway passam a recusar) e impede novas instalações — sem apagar
        nada. Reversível a qualquer momento.
      </p>

      <ConfirmDialog
        open={confirmandoBloquear !== null}
        onClose={() => setConfirmandoBloquear(null)}
        title="Bloquear aplicação"
        confirmLabel="Bloquear"
        pendingLabel="Bloqueando..."
        pending={pending && agindoEm === confirmandoBloquear?.id}
        onConfirm={() => {
          if (confirmandoBloquear) alternarBloqueio(confirmandoBloquear, true);
        }}
      >
        Todos os tokens de{" "}
        <b className="text-ink-100">{confirmandoBloquear?.name}</b> param de
        funcionar imediatamente, em qualquer servidor onde o bot esteja
        instalado. Dá para desbloquear depois, a qualquer momento.
      </ConfirmDialog>
    </div>
  );
}
