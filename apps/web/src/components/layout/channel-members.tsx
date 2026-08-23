"use client";

import { useState } from "react";
import { Headphones, Mic, MicOff, MonitorUp, MoreVertical, VolumeX } from "lucide-react";
import type { PublicChannel, ViewerContext, VoiceParticipant } from "@aether/shared";
import {
  VoiceMemberMenu,
  type MenuAnchor,
} from "@/components/voice/voice-member-menu";
import {
  UserActivityCard,
  type CardAnchor,
} from "@/components/profile/user-activity-card";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Usuarios conectados a um canal de voz, renderizados abaixo do canal.
 *
 * Os indicadores (falando / mutado / surdo / compartilhando) ja estao
 * implementados: a fase 4 apenas passa a alimentar `states` com dados reais.
 */
export function ChannelMembers({
  states,
  viewer,
  serverName,
  voiceChannels,
}: {
  states: VoiceParticipant[];
  viewer: ViewerContext;
  /** nome do servidor — o cartao de atividade diz onde a pessoa esta */
  serverName: string;
  voiceChannels: PublicChannel[];
}) {
  const [openFor, setOpenFor] = useState<
    { userId: string; anchor: MenuAnchor } | null
  >(null);
  const [openCard, setOpenCard] = useState<
    { participant: VoiceParticipant; anchor: CardAnchor } | null
  >(null);

  return (
    <ul className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-base-800 pl-2">
      {states.map((state) => {
        const muted = state.selfMuted || state.serverMuted;
        const deafened = state.selfDeafened || state.serverDeafened;

        return (
          <li
            key={state.userId}
            className="group/participant relative flex items-center gap-2 rounded-sm px-1.5 py-1 transition-colors hover:bg-base-850"
          >
            {/*
              Clicar na pessoa abre o cartao de atividade; o "..." ao lado
              continua sendo a moderacao. Sao coisas diferentes: uma e olhar,
              a outra e agir.
            */}
            <button
              type="button"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setOpenCard((current) =>
                  current?.participant.userId === state.userId
                    ? null
                    : {
                        participant: state,
                        anchor: { x: rect.right + 8, y: rect.top },
                      },
                );
              }}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
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
                  "min-w-0 flex-1 truncate text-[12px] transition-colors",
                  state.speaking && !muted ? "text-accent-300" : "text-ink-300",
                  (muted || deafened) && "text-ink-500",
                )}
              >
                {state.user.displayName}
              </span>
            </button>

            <button
              type="button"
              title="Moderar"
              aria-label={`Moderar ${state.user.displayName}`}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setOpenFor((current) =>
                  current?.userId === state.userId
                    ? null
                    : {
                        userId: state.userId,
                        // Abre logo abaixo do botao; o menu se ajusta sozinho
                        // se nao couber ate a borda da janela.
                        anchor: { x: rect.left, y: rect.bottom + 4 },
                      },
                );
              }}
              className="shrink-0 rounded-sm p-0.5 text-ink-500 opacity-0 transition-opacity hover:text-ink-100 focus:opacity-100 group-hover/participant:opacity-100"
            >
              <MoreVertical className="h-3 w-3" />
            </button>

            {openFor?.userId === state.userId ? (
              <VoiceMemberMenu
                participant={state}
                anchor={openFor.anchor}
                viewer={viewer}
                voiceChannels={voiceChannels}
                onClose={() => setOpenFor(null)}
              />
            ) : null}

            {openCard?.participant.userId === state.userId ? (
              <UserActivityCard
                user={state.user}
                serverName={serverName}
                voiceChannels={voiceChannels}
                anchor={openCard.anchor}
                onClose={() => setOpenCard(null)}
              />
            ) : null}

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
