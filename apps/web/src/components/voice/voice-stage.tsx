"use client";

import { MicOff, MonitorUp, PhoneOff, Volume2, VolumeX } from "lucide-react";
import type { PublicChannel, VoiceParticipant } from "@aether/shared";
import { Avatar } from "@/components/ui/avatar";
import { useSocket } from "@/components/realtime/realtime-provider";
import {
  useIsConnected,
  useRealtimeStore,
  useScreenShares,
  useSelfVoice,
  useVoiceParticipants,
} from "@/lib/stores/realtime-store";
import { ScreenShareView } from "@/components/voice/screen-share-view";
import { cn } from "@/lib/utils";

/**
 * Palco do canal de voz — a area central.
 *
 * Cada participante ocupa um card. O card e o MESMO container que vai receber
 * o <video> nas fases 4 e 5: quando alguem compartilha tela, o card cresce e o
 * avatar da lugar ao stream, sem trocar de layout. Por isso a grade e definida
 * por quantidade de participantes, e nao por uma lista fixa.
 *
 * Identidade propria (nao e o Discord): cards com moldura fina, cantos curtos,
 * nome ancorado no rodape do card em monoespacada, e o estado "falando" como
 * um anel de acento em vez de borda verde grossa.
 *
 * A ocupacao e o audio sao reais: quem entra aparece aqui e na arvore de
 * canais, e a voz trafega pelo SFU. Este componente NAO toca a midia — quem
 * conecta a sala e o VoiceSession, montado no layout, para a call sobreviver a
 * navegacao entre canais.
 */
export function VoiceStage({
  channel,
  selfUserId,
  canConnect,
}: {
  channel: PublicChannel;
  selfUserId: string;
  canConnect: boolean;
}) {
  const socket = useSocket();
  const connected = useIsConnected();
  const participants = useVoiceParticipants(channel.id);
  const selfVoice = useSelfVoice();
  const shares = useScreenShares();
  const localSharing = useRealtimeStore((state) => state.localSharing);
  const setMedia = useRealtimeStore((state) => state.setMedia);
  const setVoiceError = useRealtimeStore((state) => state.setVoiceError);

  const isHere = selfVoice?.channelId === channel.id;
  const full =
    channel.userLimit !== null &&
    participants.length >= channel.userLimit &&
    !isHere;
  const blocked = !connected || !canConnect || full;
  const limitLabel = channel.userLimit ? ` / ${channel.userLimit}` : "";

  function toggleConnection() {
    if (!socket) return;
    if (isHere) {
      socket.emit("voice:leave");
      setMedia(null);
      return;
    }
    socket.emit("voice:join", { channelId: channel.id }, (result) => {
      if (!result.ok) {
        // A ocupacao na tela vem do evento voice:update; o ack serve para o
        // gateway poder recusar (canal cheio, sem CONNECT) e para entregar as
        // credenciais de midia, que so existem apos a checagem de permissao.
        setVoiceError(result.error);
        return;
      }
      setVoiceError(null);
      setMedia(result.media);
    });
  }

  const action = (
    <button
      type="button"
      disabled={blocked}
      onClick={toggleConnection}
      className={cn(
        "flex items-center gap-2 rounded-md border px-3.5 py-2 text-[12px] font-medium transition-colors duration-150",
        isHere
          ? "border-signal-dnd/40 bg-signal-dnd/10 text-signal-dnd hover:bg-signal-dnd/20"
          : "border-accent-600/50 bg-accent-600/10 text-accent-300 hover:bg-accent-600/20",
        blocked && "cursor-not-allowed opacity-40",
      )}
    >
      {isHere ? (
        <>
          <PhoneOff className="h-3.5 w-3.5" />
          Desconectar
        </>
      ) : (
        <>
          <Volume2 className="h-3.5 w-3.5" />
          {full ? "Canal cheio" : "Conectar"}
        </>
      )}
    </button>
  );

  if (participants.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <div className="grid h-16 w-16 place-items-center rounded-lg border border-base-700 bg-base-900">
          <Volume2 className="h-6 w-6 text-ink-500" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-ink-200">{channel.name}</p>
          <p className="mt-1 max-w-[380px] text-balance text-[13px] leading-relaxed text-ink-500">
            {canConnect
              ? "Ninguem conectado. Ao entrar, seu nome aparece aqui e abaixo do canal na barra lateral, para todo mundo."
              : "Ninguem conectado. Seu cargo nao permite conectar neste canal."}
          </p>
          {channel.userLimit ? (
            <p className="mt-2 font-mono text-[11px] text-ink-500">
              limite: {channel.userLimit} pessoas
            </p>
          ) : null}
        </div>
        {action}
      </div>
    );
  }

  /**
   * Com alguem transmitindo, a tela vira o assunto principal e os
   * participantes descem para uma faixa compacta. Sem isso, os cards
   * disputariam espaco com o video justamente quando o video importa.
   */
  const sharing = shares.length > 0 || localSharing;

  const columns =
    participants.length === 1
      ? "grid-cols-1"
      : participants.length <= 4
        ? "grid-cols-1 sm:grid-cols-2"
        : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between px-4 pt-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-500">
          {participants.length} conectado{participants.length > 1 ? "s" : ""}
          {limitLabel}
        </span>
        {action}
      </div>

      {sharing ? <ScreenShareView /> : null}

      <div
        className={cn(
          sharing
            ? "shrink-0 overflow-x-auto px-4 pb-4"
            : "flex-1 overflow-y-auto p-4",
        )}
      >
        <div
          className={cn(
            sharing ? "flex gap-2" : cn("grid gap-3", columns),
          )}
        >
          {participants.map((participant) => (
            <ParticipantCard
              key={participant.userId}
              participant={participant}
              isSelf={participant.userId === selfUserId}
              compact={sharing}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ParticipantCard({
  participant,
  isSelf,
  compact = false,
}: {
  participant: VoiceParticipant;
  isSelf: boolean;
  compact?: boolean;
}) {
  const muted = participant.selfMuted || participant.serverMuted;
  const deafened = participant.selfDeafened || participant.serverDeafened;
  const speaking = participant.speaking && !muted;

  return (
    <div
      className={cn(
        "group relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border bg-base-900 transition-all duration-150",
        compact && "w-32 shrink-0",
        speaking
          ? "border-accent-600/70 shadow-[0_0_0_1px_var(--color-accent-600),0_0_28px_-14px_var(--color-accent-500)]"
          : "border-base-700",
      )}
    >
      {/* FASE 4/5: <video> entra aqui, ocupando o card inteiro */}
      <Avatar
        userId={participant.userId}
        name={participant.user.displayName}
        src={participant.user.avatarUrl}
        size={compact ? "sm" : "lg"}
        speaking={speaking}
      />

      {participant.streaming ? (
        <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-sm border border-signal-live/40 bg-signal-live/12 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-signal-live">
          <MonitorUp className="h-3 w-3" />
          transmitindo
        </span>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-base-950/90 to-transparent px-3 py-2.5">
        <span className="truncate font-mono text-[11px] text-ink-200">
          {participant.user.displayName}
          {isSelf ? <span className="text-ink-500"> · voce</span> : null}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {deafened ? <VolumeX className="h-3.5 w-3.5 text-signal-dnd" /> : null}
          {muted ? <MicOff className="h-3.5 w-3.5 text-signal-dnd" /> : null}
        </span>
      </div>
    </div>
  );
}
