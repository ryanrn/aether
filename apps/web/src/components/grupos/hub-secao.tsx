"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  HUB_IDADE_MINIMA_HORAS,
  HUB_TAMANHO_MAXIMO,
  HUB_TAMANHO_MINIMO,
  HUB_TAMANHO_PADRAO,
  MENSAGEM_DE_RECUSA_DO_HUB,
  normalizarNome,
  type MotivoDeRecusaDoHub,
} from "@aether/shared";
import { AetherIcon } from "@/components/ui/aether-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { criarSalaNoHubAction, entrarNoHubAction } from "@/server/actions/hub";
import type { GrupoPorJogo } from "@/server/services/grupos";

/**
 * Secao "AETHER · Grupos" da tela de Grupos — o hub global (fase 2, 4b-1).
 *
 * A tela SO ESCONDE E MOSTRA. Requisitos de conta, ban, flag e lotacao sao
 * relidos no servidor (`services/hub.ts`, `entrarNaVoz`); o `motivo` que chega
 * aqui serve para explicar ANTES do clique, nao para autorizar.
 */

export interface HubNaTela {
  hubId: string;
  membro: boolean;
  motivo: MotivoDeRecusaDoHub | null;
  salas: GrupoPorJogo[];
}

/** O que a pessoa pediu antes de aceitar as regras — retomado depois. */
type Pendente =
  | { tipo: "entrar"; channelId: string }
  | { tipo: "criar"; jogo: string; tamanho: number };

export function HubSecao({
  hub,
  jogoInicial,
  jaEmSala,
  onAbrir,
}: {
  hub: HubNaTela;
  jogoInicial: string;
  jaEmSala: boolean;
  onAbrir: (serverId: string, channelId: string) => void;
}) {
  const [membro, setMembro] = useState(hub.membro);
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, iniciar] = useTransition();

  // O auto-refresh da tela traz `hub.membro` novo (ex.: entrou em outra aba).
  useEffect(() => setMembro(hub.membro), [hub.membro]);

  const bloqueio = hub.motivo ? MENSAGEM_DE_RECUSA_DO_HUB[hub.motivo] : null;

  function executar(acao: Pendente) {
    setErro(null);
    if (acao.tipo === "entrar") {
      onAbrir(hub.hubId, acao.channelId);
      return;
    }
    iniciar(async () => {
      const r = await criarSalaNoHubAction({ jogo: acao.jogo, tamanho: acao.tamanho });
      if (r.ok) onAbrir(r.data.hubId, r.data.channelId);
      else setErro(r.error);
    });
  }

  /** Toda acao passa por aqui: quem ainda nao e membro ve as regras antes. */
  function pedir(acao: Pendente) {
    if (bloqueio) return;
    if (membro) executar(acao);
    else setPendente(acao);
  }

  function aceitarRegras() {
    const acao = pendente;
    iniciar(async () => {
      const r = await entrarNoHubAction({ aceitouRegras: true });
      if (!r.ok) {
        setErro(r.error);
        setPendente(null);
        return;
      }
      setMembro(true);
      setPendente(null);
      if (acao) executar(acao);
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-accent-500/30 bg-accent-500/[0.04] p-3.5">
      <header className="flex items-start gap-2.5">
        <AetherIcon name="compass" className="mt-0.5 h-4 w-4 text-accent-400" />
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-ink-100">AETHER · Grupos</h2>
          <p className="text-[12px] text-ink-500">
            Salas de voz por jogo, abertas a qualquer pessoa do AETHER.
          </p>
        </div>
      </header>

      {bloqueio ? (
        <p className="rounded-md border border-line bg-base-900 px-3 py-2 text-[12px] text-signal-idle">
          {bloqueio}
        </p>
      ) : (
        <CriarNoHub
          jogoInicial={jogoInicial}
          jaEmSala={jaEmSala}
          pending={pending}
          onCriar={(jogo, tamanho) => pedir({ tipo: "criar", jogo, tamanho })}
        />
      )}

      {erro ? <p className="text-[12px] text-signal-dnd">{erro}</p> : null}

      {hub.salas.length === 0 ? (
        <p className="px-1 py-2 text-[12px] text-ink-500">
          Nenhuma sala aberta no hub agora.
        </p>
      ) : (
        hub.salas.map((grupo) => (
          <div key={normalizarNome(grupo.jogo)}>
            <h3 className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-ink-400">
              {grupo.jogo}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {grupo.salas.map((sala) => {
                const cheia =
                  sala.tamanho !== null &&
                  sala.ocupacao !== null &&
                  sala.ocupacao >= sala.tamanho;
                return (
                  <li key={sala.channelId}>
                    <button
                      type="button"
                      disabled={cheia || bloqueio !== null || pending}
                      onClick={() => pedir({ tipo: "entrar", channelId: sala.channelId })}
                      className="flex w-full items-center gap-3 rounded-md border border-line bg-base-900 px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-base-850 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-400">
                        {sala.criadaPorNome
                          ? `aberta por ${sala.criadaPorNome}`
                          : "sala do hub"}
                      </span>
                      <span className="flex items-center gap-1 font-mono text-[12px] tabular-nums text-ink-400">
                        <AetherIcon name="voice" className="h-3.5 w-3.5 text-ink-500" />
                        {sala.ocupacao ?? "—"}
                        {sala.tamanho !== null ? `/${sala.tamanho}` : ""}
                      </span>
                      <span className="rounded-md bg-accent-500/15 px-2 py-1 text-[11px] font-medium text-accent-300">
                        {cheia ? "Cheia" : "Entrar"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}

      <Modal
        open={pendente !== null}
        onClose={() => setPendente(null)}
        title="Regras do hub"
        description="O hub junta pessoas que voce nao conhece. Antes de entrar:"
      >
        <RegrasDoHub
          pending={pending}
          onAceitar={aceitarRegras}
          onCancelar={() => setPendente(null)}
        />
      </Modal>
    </section>
  );
}

function CriarNoHub({
  jogoInicial,
  jaEmSala,
  pending,
  onCriar,
}: {
  jogoInicial: string;
  jaEmSala: boolean;
  pending: boolean;
  onCriar: (jogo: string, tamanho: number) => void;
}) {
  const [jogo, setJogo] = useState(jogoInicial);
  const [tamanho, setTamanho] = useState(HUB_TAMANHO_PADRAO);
  const [erro, setErro] = useState<string | null>(null);

  // Acompanha o jogo detectado enquanto a pessoa nao digitou nada.
  const tocado = useRef(false);
  useEffect(() => {
    if (!tocado.current && jogoInicial) setJogo(jogoInicial);
  }, [jogoInicial]);

  const tamanhos = Array.from(
    { length: HUB_TAMANHO_MAXIMO - HUB_TAMANHO_MINIMO + 1 },
    (_, i) => HUB_TAMANHO_MINIMO + i,
  );

  return (
    <div className="flex flex-col gap-2">
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
        <select
          value={tamanho}
          onChange={(e) => setTamanho(Number(e.target.value))}
          aria-label="Tamanho da sala"
          className="rounded-md border border-line-strong bg-base-950 px-2.5 text-[13px] text-ink-200"
        >
          {tamanhos.map((n) => (
            <option key={n} value={n}>
              {n} pessoas
            </option>
          ))}
        </select>
        <Button
          disabled={pending}
          onClick={() => {
            if (jogo.trim().length < 2) {
              setErro("Diga qual jogo.");
              return;
            }
            setErro(null);
            onCriar(jogo.trim(), tamanho);
          }}
        >
          {pending ? "Criando..." : "Criar no hub"}
        </Button>
      </div>
      {jaEmSala ? (
        <p className="text-[11px] text-signal-idle">
          Voce ja esta numa call — entrar no hub te move para a sala nova.
        </p>
      ) : null}
      {erro ? <p className="text-[12px] text-signal-dnd">{erro}</p> : null}
    </div>
  );
}

function RegrasDoHub({
  pending,
  onAceitar,
  onCancelar,
}: {
  pending: boolean;
  onAceitar: () => void;
  onCancelar: () => void;
}) {
  const [li, setLi] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] text-ink-300">
        <li>Respeito acima de tudo: nada de assedio, discurso de odio ou ameaca.</li>
        <li>Sem spam, propaganda ou golpe. A sala e para jogar junto.</li>
        <li>
          Quem esta na sala te ve e te ouve — <strong>inclusive se voce estiver
          invisivel</strong>.
        </li>
        <li>A equipe do AETHER pode remover ou banir quem quebrar as regras.</li>
        <li>
          Para sair do hub, use &quot;Sair do servidor&quot; nele, como em qualquer
          servidor.
        </li>
      </ul>
      <p className="text-[11px] text-ink-500">
        O hub abre para contas com e-mail confirmado e mais de{" "}
        {HUB_IDADE_MINIMA_HORAS} horas.
      </p>
      <label className="flex items-center gap-2 text-[13px] text-ink-200">
        <input type="checkbox" checked={li} onChange={(e) => setLi(e.target.checked)} />
        Li e aceito as regras do hub
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancelar} disabled={pending}>
          Cancelar
        </Button>
        <Button onClick={onAceitar} disabled={!li || pending}>
          {pending ? "Entrando..." : "Entrar no hub"}
        </Button>
      </div>
    </div>
  );
}
