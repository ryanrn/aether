"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AetherIcon, type AetherIconName } from "@/components/ui/aether-icon";
import type { PublicChannel, ViewerContext, VoiceParticipant } from "@aether/shared";
import { useRouter } from "next/navigation";
import { useSocket } from "@/components/realtime/realtime-provider";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { viewerCan } from "@/lib/permissions";
import {
  DEFAULT_VOLUME,
  readUserVolumes,
  saveUserVolume,
} from "@/lib/voice/volumes";
import { VolumeSlider } from "@/components/ui/volume-slider";
import { cn } from "@/lib/utils";

/**
 * Menu de um participante de voz: volume e moderacao.
 *
 * Renderizado num PORTAL para o body, com posicao fixa. Nao e detalhe de
 * estilo: a arvore de canais tem `overflow-y-auto`, e um menu posicionado
 * dentro dela era recortado na largura da barra — o slider aparecia cortado
 * pela metade. Fora da arvore, nenhum ancestral pode recorta-lo.
 *
 * Aparece em dois lugares, com conteudos diferentes:
 *  - na arvore de canais, com `viewer` e `voiceChannels`: volume + moderacao;
 *  - no card do palco (clique direito), sem eles: so o volume.
 *
 * O VOLUME nao e moderacao, e por isso aparece para todo mundo: e a
 * preferencia de quem esta OUVINDO, nao passa pelo gateway e nao muda o que os
 * outros escutam. A moderacao segue a regra de sempre — a interface so evita
 * oferecer o que sera negado, e o gateway recusa de qualquer forma.
 */

export interface MenuAnchor {
  x: number;
  y: number;
}

const MENU_WIDTH = 240;
/** Margem para o menu nunca encostar na borda da janela. */
const EDGE_GAP = 8;

export function VoiceMemberMenu({
  participant,
  anchor,
  viewer,
  voiceChannels,
  onClose,
}: {
  participant: VoiceParticipant;
  anchor: MenuAnchor;
  /** ausente = menu so de volume (card do palco) */
  viewer?: ViewerContext;
  voiceChannels?: PublicChannel[];
  onClose: () => void;
}) {
  const socket = useSocket();
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [abrindoConversa, setAbrindoConversa] = useState(false);
  const router = useRouter();
  const roomControls = useRealtimeStore((state) => state.roomControls);
  const selfUserId = useRealtimeStore((state) => state.selfUserId);
  const [volume, setVolume] = useState(
    () => readUserVolumes()[participant.userId] ?? DEFAULT_VOLUME,
  );

  /**
   * Abre conversa com esta pessoa a partir do servidor.
   *
   * O ERRO APARECE AQUI, no proprio menu, e nao some em silencio: quando a
   * pessoa nao aceita mensagem de quem nao e amigo, o gateway responde
   * dizendo isso, e a frase cabe no mesmo lugar onde ela clicou. Aceitar e
   * fingir que enviou seria pior — quem mandou iria embora achando que esta
   * sendo ignorado.
   */
  function mandarMensagem() {
    if (!socket || abrindoConversa) return;
    setAbrindoConversa(true);
    setError(null);
    socket.emit("dm:open", { userId: participant.userId }, (resultado) => {
      setAbrindoConversa(false);
      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }
      onClose();
      router.push(`/app/dm/${resultado.dm.id}`);
    });
  }

  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(anchor);

  /**
   * Reposiciona depois de medir: perto da borda direita ou de baixo, o menu
   * sairia da tela. `useLayoutEffect` para o ajuste acontecer antes da pintura,
   * senao o menu pisca na posicao errada.
   */
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition({
      x: Math.max(
        EDGE_GAP,
        Math.min(anchor.x, window.innerWidth - width - EDGE_GAP),
      ),
      y: Math.max(
        EDGE_GAP,
        Math.min(anchor.y, window.innerHeight - height - EDGE_GAP),
      ),
    });
  }, [anchor.x, anchor.y, moving]);

  /** Nao faz sentido regular o volume do proprio microfone. */
  const isSelf = participant.userId === selfUserId;
  const showVolume = !isSelf;

  function changeVolume(next: number) {
    setVolume(next);
    saveUserVolume(participant.userId, next);
    roomControls?.setUserVolume(participant.userId, next);
  }

  const canMute = viewer ? viewerCan(viewer, "MUTE_MEMBERS") : false;
  const canDeafen = viewer ? viewerCan(viewer, "DEAFEN_MEMBERS") : false;
  const canMove = viewer ? viewerCan(viewer, "MOVE_MEMBERS") : false;

  const targets = (voiceChannels ?? []).filter(
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

  if (!canMute && !canDeafen && !canMove && !showVolume) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
        className="fixed inset-0 z-[60] cursor-default"
      />
      <div
        ref={menuRef}
        style={{ left: position.x, top: position.y, width: MENU_WIDTH }}
        className="fixed z-[61] animate-rise rounded-lg border border-line bg-base-900 p-1 shadow-xl"
      >
        <p className="truncate px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
          {participant.user.displayName}
        </p>

        {/*
          PRIMEIRO item do menu, e nao o ultimo: mandar mensagem e o que mais
          se quer fazer com alguem numa lista de membros. Moderacao vem depois
          porque e rara e destrutiva.
        */}
        {participant.userId !== selfUserId ? (
          <MenuItem
            onClick={mandarMensagem}
            icon="message"
            disabled={abrindoConversa}
          >
            Mandar mensagem
          </MenuItem>
        ) : null}

        {showVolume ? (
          <div
            className={cn(
              "px-2 pb-2.5 pt-1",
              (canMute || canDeafen || canMove) && "border-b border-line",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-ink-300">
                Volume
                {volume > 1 ? (
                  <span className="ml-1.5 text-signal-idle">amplificado</span>
                ) : null}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-500">
                {Math.round(volume * 100)}%
              </span>
            </div>
            <VolumeSlider
              value={volume}
              onChange={changeVolume}
              label={`Volume de ${participant.user.displayName}`}
              className="mt-2.5"
            />
          </div>
        ) : null}

        {canMute ? (
          <MenuItem
            onClick={() => moderate({ serverMuted: !participant.serverMuted })}
            icon={participant.serverMuted ? "mic" : "mic-off"}
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
            icon={participant.serverDeafened ? "volume" : "volume-off"}
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
              <AetherIcon name="chevron" size="sm" className="shrink-0 -rotate-90 text-ink-500" />
              Mover para...
            </button>

            {moving ? (
              <div className="max-h-40 overflow-y-auto border-t border-line pt-1">
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
          <p className="border-t border-line px-2 py-1.5 text-[11px] leading-snug text-signal-dnd">
            {error}
          </p>
        ) : null}
      </div>
    </>,
    document.body,
  );
}

function MenuItem({
  children,
  icon,
  danger,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  icon: AetherIconName;
  danger?: boolean;
  /** enquanto a acao esta em voo; evita disparar duas vezes no mesmo clique */
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-base-800",
        danger ? "text-signal-dnd" : "text-ink-200",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <AetherIcon name={icon} size="sm" className="shrink-0" />
      {children}
    </button>
  );
}
