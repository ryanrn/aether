"use client";

import type { PublicUser } from "@aether/shared";
import { AetherIcon } from "@/components/ui/aether-icon";
import { Avatar } from "@/components/ui/avatar";
import { useSocket } from "@/components/realtime/realtime-provider";
import { useChamadaDmStore } from "@/lib/stores/chamada-dm-store";
import { useChamadaDm } from "@/lib/voice/use-chamada-dm";
import {
  BotaoCameraDm,
  BotaoTelaDm,
  BotaoVolumeDm,
  PalcoDaChamada,
} from "@/components/chat/chamada-dm-midia";
import { useElapsed } from "@/lib/use-elapsed";
import { cn } from "@/lib/utils";

/**
 * Chamada de voz dentro da conversa direta: o botao de ligar (cabecalho) e o
 * painel da chamada (acima das mensagens).
 *
 * So interface. Quem decide se a chamada pode acontecer e o gateway
 * (`loadDmAccess` em `dmcall:ring`); o botao nao esconde nada por permissao —
 * se a conversa abriu, a mesma regra deixa ligar.
 */

export function BotaoLigarDm({
  dmId,
  outro,
}: {
  dmId: string;
  outro: PublicUser;
}) {
  const socket = useSocket();
  const { chamada, ligar } = useChamadaDm();
  const nestaConversa = chamada?.dmId === dmId;

  return (
    <button
      type="button"
      onClick={() => ligar(dmId, outro)}
      disabled={!socket || nestaConversa}
      title={nestaConversa ? "Chamada em andamento" : "Iniciar chamada de voz"}
      aria-label="Iniciar chamada de voz"
      className={cn(
        "ml-auto grid h-8 w-8 place-items-center rounded-md text-ink-300 transition-colors",
        "hover:bg-base-800 hover:text-ink-100",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
      )}
    >
      <AetherIcon name="phone" />
    </button>
  );
}

export function PainelChamadaDm({
  dmId,
  outro,
  eu,
}: {
  dmId: string;
  outro: PublicUser;
  eu: PublicUser;
}) {
  const { chamada, atender, encerrar } = useChamadaDm();
  const conectado = useChamadaDmStore((estado) => estado.conectado);
  const outroNaSala = useChamadaDmStore((estado) => estado.outroNaSala);
  const mudo = useChamadaDmStore((estado) => estado.mudo);
  const surdo = useChamadaDmStore((estado) => estado.surdo);
  const erro = useChamadaDmStore((estado) => estado.erro);
  const aviso = useChamadaDmStore((estado) => estado.aviso);
  const setMudo = useChamadaDmStore((estado) => estado.setMudo);
  const setSurdo = useChamadaDmStore((estado) => estado.setSurdo);
  const setAviso = useChamadaDmStore((estado) => estado.setAviso);
  // Com video no palco, os avatares grandes so roubariam altura.
  const temVideo = useChamadaDmStore(
    (estado) =>
      estado.telas.length > 0 ||
      estado.cameras.length > 0 ||
      estado.minhaTela !== null ||
      estado.minhaCamera !== null,
  );

  const ativa = chamada?.dmId === dmId ? chamada : null;
  const desde =
    ativa?.fase === "em_chamada" && outroNaSala
      ? new Date(ativa.desde).toISOString()
      : null;
  const tempo = useElapsed(desde);

  if (!ativa) {
    if (aviso?.dmId !== dmId) return null;
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-base-900 px-5 py-2 text-[12px] text-ink-300">
        <AetherIcon name="phone" size="sm" className="text-ink-500" />
        <span>{aviso.texto}</span>
        <button
          type="button"
          onClick={() => setAviso(null)}
          className="ml-auto text-ink-500 hover:text-ink-200"
          aria-label="Dispensar aviso"
        >
          <AetherIcon name="x" size="sm" />
        </button>
      </div>
    );
  }

  const status =
    ativa.fase === "chamando"
      ? "Chamando..."
      : ativa.fase === "recebendo"
        ? `${outro.displayName} esta te ligando`
        : ativa.fase === "atendendo" || !conectado
          ? "Conectando..."
          : !outroNaSala
            ? `Aguardando ${outro.displayName}...`
            : `Em chamada · ${tempo ?? "00:00"}`;

  return (
    <div className="flex shrink-0 flex-col items-center gap-4 border-b border-line bg-base-950 px-5 py-6">
      {ativa.fase === "em_chamada" ? <PalcoDaChamada outro={outro} eu={eu} /> : null}
      {temVideo ? null : (
        <div className="flex items-center gap-6">
          <ParticipanteDaChamada usuario={eu} presente />
          <ParticipanteDaChamada
            usuario={outro}
            presente={ativa.fase === "em_chamada" && outroNaSala}
            tocando={ativa.fase === "chamando"}
          />
        </div>
      )}

      <div className="text-center">
        <p className="text-[13px] font-medium text-ink-100">{status}</p>
        {erro ? (
          <p className="mt-1 text-[12px] text-signal-dnd">{erro}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        {ativa.fase === "recebendo" ? (
          <BotaoRedondo onClick={atender} label="Atender" tom="positivo">
            <AetherIcon name="phone" />
          </BotaoRedondo>
        ) : null}

        {ativa.fase === "em_chamada" ? (
          <>
            <BotaoRedondo
              onClick={() => setMudo(!mudo)}
              label={mudo ? "Ativar microfone" : "Silenciar microfone"}
              tom={mudo ? "alerta" : "neutro"}
            >
              <AetherIcon name={mudo ? "mic-off" : "mic"} />
            </BotaoRedondo>
            <BotaoRedondo
              onClick={() => setSurdo(!surdo)}
              label={surdo ? "Ativar audio" : "Desativar audio"}
              tom={surdo ? "alerta" : "neutro"}
            >
              <AetherIcon name={surdo ? "headset-off" : "headset"} />
            </BotaoRedondo>
            <BotaoCameraDm />
            <BotaoTelaDm />
            <BotaoVolumeDm outro={outro} />
          </>
        ) : null}

        <BotaoRedondo
          onClick={encerrar}
          label={
            ativa.fase === "recebendo" || ativa.fase === "atendendo"
              ? "Recusar"
              : ativa.fase === "chamando"
                ? "Cancelar chamada"
                : "Desligar"
          }
          tom="perigo"
        >
          <AetherIcon name="disconnect" />
        </BotaoRedondo>
      </div>
    </div>
  );
}

function ParticipanteDaChamada({
  usuario,
  presente,
  tocando = false,
}: {
  usuario: PublicUser;
  presente: boolean;
  tocando?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-full transition-opacity",
        !presente && "opacity-50",
        tocando && "animate-pulse",
      )}
      title={usuario.displayName}
    >
      <Avatar
        userId={usuario.id}
        name={usuario.displayName}
        src={usuario.avatarUrl}
        moldura={usuario.moldura}
        size="lg"
        round
      />
    </div>
  );
}

export function BotaoRedondo({
  children,
  onClick,
  label,
  tom,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  tom: "neutro" | "alerta" | "positivo" | "perigo";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "grid h-11 w-11 place-items-center rounded-full border transition-colors active:translate-y-px",
        tom === "positivo" &&
          "border-signal-online/40 bg-signal-online text-base-950 hover:brightness-110",
        tom === "perigo" &&
          "border-signal-dnd/40 bg-signal-dnd text-white hover:brightness-110",
        tom === "alerta" &&
          "border-signal-dnd/35 bg-signal-dnd/12 text-signal-dnd hover:bg-signal-dnd/20",
        tom === "neutro" &&
          "border-line bg-base-850 text-ink-200 hover:bg-base-800 hover:text-ink-100",
      )}
    >
      {children}
    </button>
  );
}
