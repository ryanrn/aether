"use client";

import { useState } from "react";
import { Headphones, Mic, MicOff, MonitorUp, VolumeX } from "lucide-react";
import type { PublicChannel, ViewerContext, VoiceParticipant } from "@aether/shared";
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
                moldura={state.user.moldura}
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

            {/*
              NAO HA MAIS BOTAO DE TRES PONTINHOS AQUI.
              
              Ele tinha 12px, so aparecia no hover e abria um menu separado do
              cartao — entao havia duas coisas diferentes para a mesma pessoa,
              e a mais util era a mais dificil de acertar. Foi a queixa mais
              repetida.
              
              Agora clicar na PESSOA (o botao inteiro, com avatar e nome) abre
              o cartao, e o cartao ganhou o que estava no menu: volume,
              silenciar, ensurdecer e mover. Um alvo grande, um lugar so.
              
              O menu continua existindo em `voice-stage`, no BOTAO DIREITO dos
              blocos de video — la ele nao concorre com nada nem depende de
              acertar um alvo pequeno.
            */}
            {openCard?.participant.userId === state.userId ? (
              <UserActivityCard
                user={state.user}
                serverName={serverName}
                voiceChannels={voiceChannels}
                viewer={viewer}
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
