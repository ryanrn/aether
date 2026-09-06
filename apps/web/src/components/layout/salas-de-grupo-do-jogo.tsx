"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AetherIcon } from "@/components/ui/aether-icon";
import { normalizarNome, type PublicChannel } from "@aether/shared";
import { useEntrarNaVoz } from "@/lib/voice/use-entrar-na-voz";
import { useVoiceParticipants } from "@/lib/stores/realtime-store";
import { criarSalaDeGrupoAction } from "@/server/actions/salas-de-grupo";

/**
 * Salas de grupo (LFG) de um jogo, dentro da secao "Jogando agora" do painel
 * de membros (fase 2, estagio 3).
 *
 * Mostra as salas efemeras abertas para aquele jogo (com contagem viva + botao
 * Entrar) e, se o servidor permite e voce esta jogando isto sem sala, um botao
 * Criar. A sala em si e um canal de voz `isTemporary` — some quando esvazia,
 * pelo gateway.
 */
export function SalasDeGrupoDoJogo({
  serverId,
  jogo,
  canaisDeVoz,
  podeCriar,
  jaTenhoSala,
}: {
  serverId: string;
  jogo: string;
  /** todos os canais de voz do servidor — filtramos as salas deste jogo */
  canaisDeVoz: PublicChannel[];
  /** salas ligadas no servidor E eu estou jogando este jogo */
  podeCriar: boolean;
  /** ja abri uma sala neste servidor (1 por pessoa) */
  jaTenhoSala: boolean;
}) {
  const router = useRouter();
  const { entrar } = useEntrarNaVoz();
  const [pending, iniciar] = useTransition();

  const alvo = normalizarNome(jogo);
  const salas = canaisDeVoz.filter(
    (canal) =>
      canal.isTemporary &&
      canal.jogo != null &&
      normalizarNome(canal.jogo) === alvo,
  );

  function abrir(channelId: string) {
    router.push(`/app/s/${serverId}/c/${channelId}`);
    entrar(channelId);
  }

  function criar() {
    iniciar(async () => {
      const resultado = await criarSalaDeGrupoAction({ serverId, jogo });
      if (resultado.ok) abrir(resultado.data.channelId);
    });
  }

  const mostrarCriar = podeCriar && !jaTenhoSala;
  if (salas.length === 0 && !mostrarCriar) return null;

  return (
    <div className="mb-1 flex flex-col gap-px pl-6">
      {salas.map((sala) => (
        <LinhaDeSala key={sala.id} sala={sala} onEntrar={() => abrir(sala.id)} />
      ))}
      {mostrarCriar ? (
        <button
          type="button"
          onClick={criar}
          disabled={pending}
          className="flex items-center gap-1.5 rounded-[4px] px-1.5 py-1 text-left text-[11px] text-accent-400 transition-colors hover:bg-base-850 hover:text-accent-300 disabled:opacity-50"
        >
          <AetherIcon name="plus" className="h-3 w-3 shrink-0" />
          {pending ? "Criando sala..." : "Criar sala de grupo"}
        </button>
      ) : null}
    </div>
  );
}

function LinhaDeSala({
  sala,
  onEntrar,
}: {
  sala: PublicChannel;
  onEntrar: () => void;
}) {
  const participantes = useVoiceParticipants(sala.id);
  return (
    <button
      type="button"
      onClick={onEntrar}
      className="flex items-center gap-1.5 rounded-[4px] px-1.5 py-1 text-left text-[11px] text-ink-300 transition-colors hover:bg-base-850 hover:text-ink-100"
    >
      <AetherIcon name="voice" className="h-3 w-3 shrink-0 text-ink-500" />
      <span className="min-w-0 flex-1 truncate">Sala de grupo</span>
      <span className="font-mono tabular-nums text-ink-500">
        {participantes.length}
      </span>
      <span className="text-accent-400">Entrar</span>
    </button>
  );
}
