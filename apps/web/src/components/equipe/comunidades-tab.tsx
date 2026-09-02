"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import {
  categoriaPorId,
  type PedidoDeVitrine,
  type VitrineStatus,
} from "@aether/shared";
import {
  listarPedidosAction,
  revisarPedidoAction,
} from "@/server/actions/descoberta";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Pedidos para aparecer em "Explorar comunidades".
 *
 * POR QUE ESTA FILA EXISTE: a primeira versao deixava o dono se listar
 * sozinho. Como qualquer pessoa cria conta e servidor, isso abria a vitrine
 * para spam — e, pior, para alguem criar um servidor chamado "AETHER OFICIAL"
 * e ficar ao lado do nosso. O selo protege o nome, mas muita gente nao olha
 * selo.
 *
 * Mesma regra da biblioteca de jogos, e agora aplicada nos dois lugares: o que
 * aparece para todo mundo passa por revisao.
 */

const ABAS: { id: VitrineStatus; rotulo: string }[] = [
  { id: "PENDENTE", rotulo: "Esperando" },
  { id: "APROVADO", rotulo: "Na vitrine" },
  { id: "RECUSADO", rotulo: "Recusados" },
];

export function ComunidadesTab({
  /** Mesma razao da fila de jogos: o numerinho da engrenagem baixa junto. */
  onPendentes,
}: {
  onPendentes?: (pendentes: number) => void;
}) {
  const [status, setStatus] = useState<VitrineStatus>("PENDENTE");
  const [pedidos, setPedidos] = useState<PedidoDeVitrine[]>([]);
  const [pendentes, setPendentes] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [pending, startTransition] = useTransition();

  /** Ref, e nao dependencia: veja o comentario igual em `jogos-tab`. */
  const avisar = useRef(onPendentes);
  useEffect(() => {
    avisar.current = onPendentes;
  });

  const carregar = useCallback((alvo: VitrineStatus) => {
    setCarregando(true);
    setErro(null);
    listarPedidosAction(alvo)
      .then((r) => {
        if (r.ok) {
          setPedidos(r.data.pedidos);
          setPendentes(r.data.pendentes);
          avisar.current?.(r.data.pendentes);
        } else {
          setErro(r.error);
        }
      })
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => {
    carregar(status);
  }, [status, carregar]);

  function revisar(pedido: PedidoDeVitrine, decisao: "APROVADO" | "RECUSADO") {
    setErro(null);
    startTransition(async () => {
      const r = await revisarPedidoAction(pedido.id, decisao);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      if (!r.data.aplicado) {
        setErro("Esse pedido ja tinha sido revisado. Recarreguei a fila.");
        carregar(status);
        return;
      }
      setPedidos((atual) => atual.filter((p) => p.id !== pedido.id));
      const restam = Math.max(0, pendentes - 1);
      setPendentes(restam);
      avisar.current?.(restam);
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-ink-100">
            Comunidades na vitrine
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Servidores que pediram para aparecer.{" "}
            {pendentes > 0 ? (
              <span className="text-amber-300">{pendentes} esperando.</span>
            ) : (
              "Nada esperando."
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => carregar(status)}
          disabled={carregando || pending}
        >
          <AetherIcon
            name="refresh"
            className={cn("h-3.5 w-3.5", carregando && "animate-spin")}
          />
        </Button>
      </div>

      <div className="flex gap-1">
        {ABAS.map((aba) => (
          <button
            key={aba.id}
            type="button"
            onClick={() => setStatus(aba.id)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] transition-colors",
              status === aba.id
                ? "bg-base-800 text-ink-100"
                : "text-ink-400 hover:bg-base-850 hover:text-ink-200",
            )}
          >
            {aba.rotulo}
          </button>
        ))}
      </div>

      {erro ? (
        <p className="rounded-md border border-signal-dnd/30 bg-signal-dnd/10 px-3 py-2 text-xs text-signal-dnd">
          {erro}
        </p>
      ) : null}

      {carregando ? (
        <p className="text-xs text-ink-500">Carregando...</p>
      ) : pedidos.length === 0 ? (
        <p className="rounded-md border border-base-800 bg-base-850/60 px-3 py-6 text-center text-xs text-ink-500">
          Nada aqui.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pedidos.map((p) => {
            const categoria = categoriaPorId(p.categoria);
            return (
              <li
                key={p.id}
                className="flex flex-col gap-2 rounded-md border border-base-800 bg-base-850/60 p-3"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar
                    userId={p.id}
                    name={p.nome}
                    src={p.iconUrl}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink-100">
                      {p.nome}
                    </p>
                    <p className="truncate text-[11px] text-ink-500">
                      @{p.dono} · {p.membros}{" "}
                      {p.membros === 1 ? "membro" : "membros"}
                      {categoria ? ` · ${categoria.nome}` : ""}
                    </p>
                  </div>
                </div>

                {/*
                  A descricao aparece INTEIRA aqui, e nao cortada em duas linhas
                  como no card: quem revisa precisa ler o que vai para a
                  vitrine, e nao uma amostra.
                */}
                <p
                  className={cn(
                    "text-[12px] leading-relaxed",
                    p.descricao ? "text-ink-300" : "italic text-ink-600",
                  )}
                >
                  {p.descricao ?? "Sem descricao."}
                </p>

                {status === "PENDENTE" ? (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => revisar(p, "APROVADO")}
                      disabled={pending}
                    >
                      <AetherIcon name="check" className="h-3.5 w-3.5" />
                      Aprovar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => revisar(p, "RECUSADO")}
                      disabled={pending}
                    >
                      <AetherIcon name="x" className="h-3.5 w-3.5" />
                      Recusar
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
