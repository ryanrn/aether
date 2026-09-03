"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import type { JogoNaFila, StatusDeJogo } from "@aether/shared";
import { listarFilaAction, revisarJogoAction } from "@/server/actions/jogos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * A fila de jogos sugeridos pela comunidade.
 *
 * SO A EQUIPE VE ESTA ABA — e quem decide isso e o servidor, nao esta tela.
 * A aba nem e desenhada para quem nao e da equipe, mas isso e cortesia: as
 * duas actions que ela chama recusam por conta propria, respondendo como se
 * nao existissem.
 *
 * POR QUE UMA FILA E NAO APROVACAO AUTOMATICA: um jogo aprovado passa a valer
 * para a base inteira. Sem revisao, bastaria uma pessoa sugerir "chrome.exe =
 * Google Chrome" para todo mundo aparecer jogando Chrome — e nada no sistema
 * teria como saber que esta errado.
 */

const ABAS: { id: StatusDeJogo; rotulo: string }[] = [
  { id: "PENDENTE", rotulo: "Esperando" },
  { id: "APROVADO", rotulo: "Aprovados" },
  { id: "RECUSADO", rotulo: "Recusados" },
];

export function JogosTab({
  /**
   * Avisa o numerinho da engrenagem de quantos ainda esperam.
   *
   * Existe para o marcador NAO ficar mentindo enquanto esta tela esta aberta:
   * quem aprova aqui ve a fila baixar, e o aviso la fora tem de baixar junto.
   */
  onPendentes,
}: {
  onPendentes?: (pendentes: number) => void;
}) {
  const [status, setStatus] = useState<StatusDeJogo>("PENDENTE");
  const [fila, setFila] = useState<JogoNaFila[]>([]);
  const [pendentes, setPendentes] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [pending, startTransition] = useTransition();

  /** O nome editado por linha — a revisao corrige antes de aprovar. */
  const [nomes, setNomes] = useState<Record<string, string>>({});

  /**
   * O aviso guardado numa ref, e nao usado direto.
   *
   * `carregar` e memoizado com dependencias vazias, e um `useEffect` depende
   * dele. Se a funcao do pai entrasse nas dependencias, cada render do pai
   * criaria uma funcao nova, `carregar` mudaria de identidade e o efeito
   * recarregaria a fila em loop. A ref deixa a chamada sempre atual sem
   * participar da identidade.
   */
  const avisar = useRef(onPendentes);
  useEffect(() => {
    avisar.current = onPendentes;
  });

  const carregar = useCallback((alvo: StatusDeJogo) => {
    setCarregando(true);
    setErro(null);
    listarFilaAction(alvo)
      .then((r) => {
        if (r.ok) {
          setFila(r.data.fila);
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

  function revisar(jogo: JogoNaFila, decisao: "APROVADO" | "RECUSADO") {
    setErro(null);
    const nomeFinal = (nomes[jogo.id] ?? jogo.nome).trim();

    startTransition(async () => {
      const r = await revisarJogoAction(jogo.id, decisao, nomeFinal);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      if (!r.data.aplicado) {
        /*
         * Outra pessoa da equipe revisou esta linha antes. Recarregar em vez
         * de insistir: a tela esta velha, e o certo e mostrar a verdade.
         */
        setErro("Alguem ja revisou este. Recarreguei a fila.");
        carregar(status);
        return;
      }
      setFila((atual) => atual.filter((j) => j.id !== jogo.id));
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
            Jogos da comunidade
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">
            O que as pessoas ensinaram ao app.{" "}
            {pendentes > 0 ? (
              <span className="text-amber-300">
                {pendentes} esperando revisao.
              </span>
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
      ) : fila.length === 0 ? (
        <p className="rounded-md border border-line bg-base-850/60 px-3 py-6 text-center text-xs text-ink-500">
          Nada aqui.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {fila.map((jogo) => (
            <li
              key={jogo.id}
              className="flex flex-col gap-2 rounded-md border border-line bg-base-850/60 p-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <code className="min-w-0 truncate font-mono text-[11px] text-ink-400">
                  {jogo.executavel}
                </code>
                {/*
                  PESSOAS distintas, e nao cliques: o par (jogo, pessoa) e unico
                  no banco. Sem isso o numero nao significaria nada.
                */}
                <span className="shrink-0 text-[10px] text-ink-500">
                  {jogo.sugestoes} {jogo.sugestoes === 1 ? "pessoa" : "pessoas"}
                </span>
              </div>

              {status === "PENDENTE" ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={nomes[jogo.id] ?? jogo.nome}
                    onChange={(e) =>
                      setNomes((n) => ({ ...n, [jogo.id]: e.target.value }))
                    }
                    maxLength={80}
                    className="h-8 text-[13px]"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => revisar(jogo, "APROVADO")}
                    disabled={pending}
                    title="Aprovar"
                  >
                    <AetherIcon name="check" className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => revisar(jogo, "RECUSADO")}
                    disabled={pending}
                    title="Recusar"
                  >
                    <AetherIcon name="x" className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <p className="text-[13px] text-ink-100">{jogo.nome}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
