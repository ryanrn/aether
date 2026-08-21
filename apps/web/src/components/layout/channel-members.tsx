"use client";

import { Headphones, Mic, MicOff, MonitorUp, VolumeX } from "lucide-react";
import type { VoiceParticipant } from "@aether/shared";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Usuarios conectados a um canal de voz, renderizados abaixo do canal.
 *
 * Os indicadores (falando / mutado / surdo / compartilhando) ja estao
 * implementados: a fase 4 apenas passa a alimentar `states` com dados reais.
 */
export function ChannelMembers({ states }: { states: VoiceParticipant[] }) {
  return (
    <ul className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-base-800 pl-2">
      {states.map((state) => {
        const muted = state.selfMuted || state.serverMuted;
        const deafened = state.selfDeafened || state.serverDeafened;

        return (
          <li
            key={state.userId}
            className="flex items-center gap-2 rounded-sm px-1.5 py-1 transition-colors hover:bg-base-850"
          >
            <Avatar
              userId={state.userId}
              name={state.user.displayName}
              src={state.user.avatarUrl}
              size="xs"
              speaking={state.speaking && !muted}
            />
            <span
              className={cn(
                "flex-1 truncate text-[12px] transition-colors",
                state.speaking && !muted ? "text-accent-300" : "text-ink-300",
                (muted || deafened) && "text-ink-500",
              )}
            >
              {state.user.displayName}
            </span>

            <span className="flex items-center gap-1 text-ink-500">
              {state.streaming ? (
                <MonitorUp
                  className="h-3 w-3 text-signal-live"
                  aria-label="Compartilhando tela"
                />
              ) : null}
              {deafened ? (
                <VolumeX className="h-3 w-3 text-signal-dnd" aria-label="Surdo" />
              ) : state.serverDeafened ? (
                <Headphones className="h-3 w-3 text-signal-dnd" />
              ) : null}
              {muted ? (
                <MicOff className="h-3 w-3 text-signal-dnd" aria-label="Mutado" />
              ) : state.speaking ? (
                <Mic className="h-3 w-3 text-accent-400" aria-label="Falando" />
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
