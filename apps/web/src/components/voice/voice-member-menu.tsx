"use client";

import { useState } from "react";
import { Mic, MicOff, MoveRight, Volume2, VolumeX } from "lucide-react";
import type { PublicChannel, ViewerContext, VoiceParticipant } from "@aether/shared";
import { useSocket } from "@/components/realtime/realtime-provider";
import { viewerCan } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * Moderacao de voz sobre um participante.
 *
 * Fica na arvore de canais, e nao no palco, por um motivo pratico: e aqui que
 * existe a lista de canais de voz, necessaria para o "mover para". O palco so
 * conhece o proprio canal.
 *
 * Nada aqui decide permissao — o gateway recusa o que nao pode. A interface so
 * evita oferecer o que sera negado, e mostra o motivo quando a recusa vem.
 */
export function VoiceMemberMenu({
  participant,
  viewer,
  voiceChannels,
  onClose,
}: {
  participant: VoiceParticipant;
  viewer: ViewerContext;
  voiceChannels: PublicChannel[];
  onClose: () => void;
}) {
  const socket = useSocket();
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const canMute = viewerCan(viewer, "MUTE_MEMBERS");
  const canDeafen = viewerCan(viewer, "DEAFEN_MEMBERS");
  const canMove = viewerCan(viewer, "MOVE_MEMBERS");

  const targets = voiceChannels.filter(
    (channel) => channel.id !== participant.channelId,
  );

  function moderate(patch: { serverMuted?: boolean; serverDeafened?: boolean }) {
    setError(null);
    socket?.emit(
      "voice:moderate",
      { userId: participant.userId, ...patch },
      (result) => {
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onClose();
      },
    );
  }

  function move(channelId: string) {
    setError(null);
    socket?.emit(
      "voice:move",
      { userId: participant.userId, channelId },
      (result) => {
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onClose();
      },
    );
  }

  if (!canMute && !canDeafen && !canMove) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div className="absolute left-2 top-6 z-50 w-56 animate-rise rounded-lg border border-base-700 bg-base-900 p-1 shadow-xl">
        <p className="truncate px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
          {participant.user.displayName}
        </p>

        {canMute ? (
          <MenuItem
            onClick={() => moderate({ serverMuted: !participant.serverMuted })}
            icon={participant.serverMuted ? Mic : MicOff}
            danger={!participant.serverMuted}
          >
            {participant.serverMuted
              ? "Devolver o microfone"
              : "Silenciar no servidor"}
          </MenuItem>
        ) : null}

        {canDeafen ? (
          <MenuItem
            onClick={() =>
              moderate({ serverDeafened: !participant.serverDeafened })
            }
            icon={participant.serverDeafened ? Volume2 : VolumeX}
            danger={!participant.serverDeafened}
          >
            {participant.serverDeafened
              ? "Devolver o audio"
              : "Ensurdecer no servidor"}
          </MenuItem>
        ) : null}

        {canMove && targets.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() => setMoving((open) => !open)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink-200 transition-colors hover:bg-base-800"
            >
              <MoveRight className="h-3.5 w-3.5 shrink-0 text-ink-500" />
              Mover para...
            </button>

            {moving ? (
              <div className="max-h-40 overflow-y-auto border-t border-base-800 pt-1">
                {targets.map((channel) => (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => move(channel.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 pl-7 text-left text-[12px] text-ink-300 transition-colors hover:bg-base-800 hover:text-ink-100"
                  >
                    <span className="truncate">{channel.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {error ? (
          <p className="border-t border-base-800 px-2 py-1.5 text-[11px] leading-snug text-signal-dnd">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
}

function MenuItem({
  children,
  icon: Icon,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-base-800",
        danger ? "text-signal-dnd" : "text-ink-200",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {children}
    </button>
  );
}
