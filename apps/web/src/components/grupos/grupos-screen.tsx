"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AetherIcon } from "@/components/ui/aether-icon";
import { normalizarNome } from "@aether/shared";
import { listarGruposAction } from "@/server/actions/grupos";
import { criarSalaDeGrupoAction } from "@/server/actions/salas-de-grupo";
import type { GrupoPorJogo } from "@/server/services/grupos";
import { useEntrarNaVoz } from "@/lib/voice/use-entrar-na-voz";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { HubSecao, type HubNaTela } from "./hub-secao";

/** De quanto em quanto a tela repergunta a lista (nao ha socket ao vivo aqui). */
const REFRESH_MS = 20_000;

export function GruposScreen({
  inicial,
  servidores,
  selfUserId,
  hubInicial,
}: {
  inicial: GrupoPorJogo[];
  servidores: { id: string; nome: string }[];
  selfUserId: string;
  /** `null` = sem hub (flag desligada ou nenhum marcado): a secao nao existe. */
  hubInicial: HubNaTela | null;
}) {
  const [grupos, setGrupos] = useState(inicial);
  const [hub, setHub] = useState(hubInicial);
  const [atualizando, setAtualizando] = useState(false);
  const router = useRouter();
  const { entrar } = useEntrarNaVoz();

  /** O que EU estou jogando agora — para pre-preencher o "Criar grupo". */
  const activity = useRealtimeStore((estado) => estado.activity);
  const selfVoice = useRealtimeStore((estado) => estado.selfVoice);
  const meuJogo = useMemo(
    () => activity[selfUserId]?.game ?? "",
    [activity, selfUserId],
  );

  const recarregar = useRef(async () => {
    setAtualizando(true);
    const r = await listarGruposAction();
    if (r.ok) {
      setGrupos(r.data.meus);
      // O estado de membro/motivo nao muda pelo refresh; so as salas.
      setHub((atual) =>
        atual && r.data.hub ? { ...atual, salas: r.data.hub } : r.data.hub ? atual : null,
      );
    }
    setAtualizando(false);
  });

  useEffect(() => {
    const id = setInterval(() => void recarregar.current(), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  function abrir(serverId: string, channelId: string) {
    router.push(`/app/s/${serverId}/c/${channelId}`);
    entrar(channelId);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-base-950">
      <header className="flex items-center gap-3 border-b border-line px-6 py-4">
        <AetherIcon name="gamepad" className="h-5 w-5 text-accent-400" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-semibold text-ink-100">Grupos</h1>
          <p className="text-[12px] text-ink-500">
            Salas de voz por jogo, abertas nos seus servidores.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void recarregar.current()}
          disabled={atualizando}
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-300 transition-colors hover:bg-base-850 hover:text-ink-100 disabled:opacity-50"
        >
          <AetherIcon
            name="loader"
            className={cn("h-3.5 w-3.5", atualizando && "animate-spin")}
          />
          Atualizar
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[720px] flex-col gap-6 px-6 py-6">
          {hub ? (
            <HubSecao
              hub={hub}
              jogoInicial={meuJogo}
              jaEmSala={selfVoice?.channelId != null}
              onAbrir={abrir}
            />
          ) : null}

          <CriarGrupo
            servidores={servidores}
            jogoInicial={meuJogo}
            jaEmSala={selfVoice?.channelId != null}
            onCriada={abrir}
          />

          {grupos.length === 0 ? (
            <p className="rounded-md border border-line bg-base-900 px-4 py-8 text-center text-[13px] text-ink-500">
              Nenhum grupo aberto nos seus servidores agora. Crie o primeiro
              acima — ou entre em mais servidores.
            </p>
          ) : (
            grupos.map((grupo) => (
              <section key={normalizarNome(grupo.jogo)}>
                <h2 className="mb-2 flex items-center gap-2 font-mono text-[12px] font-bold uppercase tracking-[0.08em] text-ink-400">
                  {grupo.jogo}
                  <span className="text-ink-600">
                    {grupo.salas.length} sala
                    {grupo.salas.length > 1 ? "s" : ""}
                  </span>
                </h2>
                <ul className="flex flex-col gap-1.5">
                  {grupo.salas.map((sala) => (
                    <li key={sala.channelId}>
                      <button
                        type="button"
                        onClick={() => abrir(sala.serverId, sala.channelId)}
                        className="flex w-full items-center gap-3 rounded-md border border-line bg-base-900 px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-base-850"
                      >
                        <ServerIcon
                          nome={sala.serverNome}
                          icone={sala.serverIcone}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-ink-100">
                            {sala.serverNome}
                          </span>
                          <span className="block truncate text-[11px] text-ink-500">
                            {sala.criadaPorNome
                              ? `aberta por ${sala.criadaPorNome}`
                              : "sala de grupo"}
                          </span>
                        </span>
                        <span className="flex items-center gap-1 font-mono text-[12px] tabular-nums text-ink-400">
                          <AetherIcon
                            name="voice"
                            className="h-3.5 w-3.5 text-ink-500"
                          />
                          {sala.ocupacao ?? "—"}
                        </span>
                        <span className="rounded-md bg-accent-500/15 px-2 py-1 text-[11px] font-medium text-accent-300">
                          Entrar
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function CriarGrupo({
  servidores,
  jogoInicial,
  jaEmSala,
  onCriada,
}: {
  servidores: { id: string; nome: string }[];
  jogoInicial: string;
  jaEmSala: boolean;
  onCriada: (serverId: string, channelId: string) => void;
}) {
  const [jogo, setJogo] = useState(jogoInicial);
  const [serverId, setServerId] = useState(servidores[0]?.id ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, iniciar] = useTransition();

  // Se o jogo detectado mudar depois do primeiro render, acompanha — mas so
  // enquanto o usuario nao digitou nada por conta propria.
  const tocado = useRef(false);
  useEffect(() => {
    if (!tocado.current && jogoInicial) setJogo(jogoInicial);
  }, [jogoInicial]);

  if (servidores.length === 0) {
    return (
      <div className="rounded-md border border-line bg-base-900 px-4 py-3 text-[12px] text-ink-500">
        Nenhum dos seus servidores permite salas de grupo. Um dono pode ligar em
        <span className="text-ink-300"> Configuracoes › Geral</span>.
      </div>
    );
  }

  function criar() {
    if (jogo.trim().length < 2) {
      setErro("Diga qual jogo.");
      return;
    }
    setErro(null);
    iniciar(async () => {
      const r = await criarSalaDeGrupoAction({ serverId, jogo: jogo.trim() });
      if (r.ok) onCriada(serverId, r.data.channelId);
      else setErro(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-line bg-base-900 p-3.5">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-400">
        Criar grupo
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          value={jogo}
          onChange={(e) => {
            tocado.current = true;
            setJogo(e.target.value);
          }}
          placeholder="Qual jogo?"
          maxLength={64}
          className="min-w-[160px] flex-1"
        />
        {servidores.length > 1 ? (
          <select
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
            className="rounded-md border border-line-strong bg-base-950 px-2.5 text-[13px] text-ink-200"
          >
            {servidores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
        ) : null}
        <Button onClick={criar} disabled={pending}>
          {pending ? "Criando..." : "Criar e entrar"}
        </Button>
      </div>
      {servidores.length === 1 ? (
        <p className="text-[11px] text-ink-600">em {servidores[0]!.nome}</p>
      ) : null}
      {jaEmSala ? (
        <p className="text-[11px] text-signal-idle">
          Voce ja esta numa call — criar um grupo te move para a sala nova.
        </p>
      ) : null}
      {erro ? <p className="text-[12px] text-signal-dnd">{erro}</p> : null}
    </div>
  );
}

function ServerIcon({
  nome,
  icone,
}: {
  nome: string;
  icone: string | null;
}) {
  if (icone) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={icone}
        alt=""
        className="h-8 w-8 shrink-0 rounded-md object-cover"
      />
    );
  }
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-base-750 text-[12px] font-semibold text-ink-300">
      {nome.slice(0, 1).toUpperCase()}
    </span>
  );
}
