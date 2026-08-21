"use client";

import { MicOff, MonitorUp, Volume2, VolumeX } from "lucide-react";
import type { PublicChannel, VoiceParticipant } from "@aether/shared";
import { Avatar } from "@/components/ui/avatar";
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
 */
export function VoiceStage({
  channel,
  participants,
  selfUserId,
}: {
  channel: PublicChannel;
  participants: VoiceParticipant[];
  selfUserId: string;
}) {
  if (participants.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <div className="grid h-16 w-16 place-items-center rounded-lg border border-base-700 bg-base-900">
          <Volume2 className="h-6 w-6 text-ink-500" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-ink-200">{channel.name}</p>
          <p className="mt-1 max-w-[380px] text-balance text-[13px] leading-relaxed text-ink-500">
            Ninguem conectado. A conexao de voz entra na fase 4 — este palco ja
            e o container que vai receber o audio e, na fase 5, o
            compartilhamento de tela.
          </p>
          {channel.userLimit ? (
            <p className="mt-2 font-mono text-[11px] text-ink-500">
              limite: {channel.userLimit} pessoas
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const columns =
    participants.length === 1
      ? "grid-cols-1"
      : participants.length <= 4
        ? "grid-cols-1 sm:grid-cols-2"
        : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className={cn("grid gap-3", columns)}>
        {participants.map((participant) => (
          <ParticipantCard
            key={participant.userId}
            participant={participant}
            isSelf={participant.userId === selfUserId}
          />
        ))}
      </div>
    </div>
  );
}

function ParticipantCard({
  participant,
  isSelf,
}: {
  participant: VoiceParticipant;
  isSelf: boolean;
}) {
  const muted = participant.selfMuted || participant.serverMuted;
  const deafened = participant.selfDeafened || participant.serverDeafened;
  const speaking = participant.speaking && !muted;

  return (
    <div
      className={cn(
        "group relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border bg-base-900 transition-all duration-150",
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
        size="lg"
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
