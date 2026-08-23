"use client";

import { useEffect, useRef, useState } from "react";
import {
  Maximize2,
  MonitorUp,
  PictureInPicture2,
  Pin,
  PinOff,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { Track } from "livekit-client";
import {
  useRealtimeStore,
  useScreenShares,
} from "@/lib/stores/realtime-store";
import {
  DEFAULT_VOLUME,
  readScreenVolume,
  saveScreenVolume,
} from "@/lib/voice/volumes";
import { cn } from "@/lib/utils";

/**
 * Area de compartilhamento de tela.
 *
 * Layout: um stream em DESTAQUE ocupando a area principal, e miniaturas dos
 * demais embaixo. Clicar numa miniatura troca o destaque; o alfinete fixa a
 * escolha para que a entrada de um novo compartilhamento nao roube a atencao
 * no meio de uma explicacao.
 *
 * Sem alfinete, o destaque e automatico: o primeiro que estiver no ar. Assim a
 * tela funciona sozinha quando so ha uma pessoa transmitindo, que e o caso
 * comum.
 */
export function ScreenShareView() {
  const shares = useScreenShares();
  const localTrack = useRealtimeStore((state) => state.localShareTrack);
  const localSharing = useRealtimeStore((state) => state.localSharing);
  const selfUserId = useRealtimeStore((state) => state.selfUserId);
  const focusedId = useRealtimeStore((state) => state.focusedShareUserId);
  const setFocusedShare = useRealtimeStore((state) => state.setFocusedShare);

  /** A propria transmissao entra na lista para voce conferir o que esta enviando. */
  const all: { userId: string; label: string; track: Track }[] = [
    ...(localSharing && localTrack && selfUserId
      ? [{ userId: selfUserId, label: "Voce", track: localTrack }]
      : []),
    ...shares.map((share) => ({
      userId: share.userId,
      label: share.displayName,
      track: share.track as unknown as Track,
    })),
  ];

  if (all.length === 0) return null;

  const focused = all.find((item) => item.userId === focusedId) ?? all[0];
  if (!focused) return null;
  const others = all.filter((item) => item.userId !== focused.userId);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
      <FocusedStream
        label={focused.label}
        track={focused.track}
        pinned={focusedId === focused.userId}
        onTogglePin={() =>
          setFocusedShare(focusedId === focused.userId ? null : focused.userId)
        }
      />

      {others.length > 0 ? (
        <div className="flex shrink-0 gap-2 overflow-x-auto pb-1">
          {others.map((item) => (
            <button
              key={item.userId}
              type="button"
              onClick={() => setFocusedShare(item.userId)}
              title={`Ver a tela de ${item.label}`}
              className="group relative aspect-video w-40 shrink-0 overflow-hidden rounded-md border border-base-700 bg-base-950 transition-colors hover:border-accent-600/60"
            >
              <TrackVideo track={item.track} className="h-full w-full object-contain" />
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-base-950/90 to-transparent px-2 py-1 text-left font-mono text-[10px] text-ink-300">
                {item.label}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FocusedStream({
  label,
  track,
  pinned,
  onTogglePin,
}: {
  label: string;
  track: Track;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [pipAvailable, setPipAvailable] = useState(false);

  useEffect(() => {
    setPipAvailable(
      typeof document !== "undefined" && document.pictureInPictureEnabled,
    );
  }, []);

  async function toggleFullscreen() {
    const element = containerRef.current;
    if (!element) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    await element.requestFullscreen().catch(() => undefined);
  }

  async function togglePip() {
    const video = videoRef.current;
    if (!video) return;
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(() => undefined);
      return;
    }
    await video.requestPictureInPicture().catch(() => undefined);
  }

  return (
    <div
      ref={containerRef}
      className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-base-700 bg-base-950"
    >
      <TrackVideo
        track={track}
        onElement={(element) => (videoRef.current = element)}
        className="h-full w-full object-contain"
      />

      <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-sm border border-signal-live/40 bg-base-950/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-signal-live backdrop-blur">
        <MonitorUp className="h-3 w-3" />
        {label}
      </div>

      <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 hover:opacity-100">
        <StreamAction
          label={pinned ? "Desafixar destaque" : "Fixar este compartilhamento"}
          onClick={onTogglePin}
          active={pinned}
        >
          {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </StreamAction>

        {pipAvailable ? (
          <StreamAction label="Picture-in-picture" onClick={() => void togglePip()}>
            <PictureInPicture2 className="h-3.5 w-3.5" />
          </StreamAction>
        ) : null}

        <ScreenAudioVolume />

        <StreamAction label="Tela cheia" onClick={() => void toggleFullscreen()}>
          <Maximize2 className="h-3.5 w-3.5" />
        </StreamAction>
      </div>
    </div>
  );
}

/**
 * Volume do audio que vem junto do compartilhamento de tela.
 *
 * Um controle SO para todas as telas, e nao um por transmissao: na pratica
 * uma pessoa compartilha por vez, e um slider por miniatura seria mais
 * interface do que utilidade. Se um dia duas transmissoes com som ao mesmo
 * tempo virarem comum, vira um por pessoa.
 *
 * O valor e local e persiste no navegador — nao afeta o que os outros ouvem.
 */
function ScreenAudioVolume() {
  const roomControls = useRealtimeStore((state) => state.roomControls);
  const [open, setOpen] = useState(false);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);

  // localStorage nao existe no servidor: so lemos depois de montar.
  useEffect(() => setVolume(readScreenVolume()), []);

  function change(next: number) {
    setVolume(next);
    saveScreenVolume(next);
    roomControls?.setScreenAudioVolume(next);
  }

  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="relative">
      <StreamAction
        label={`Volume do audio da tela (${Math.round(volume * 100)}%)`}
        onClick={() => setOpen((value) => !value)}
        active={open}
      >
        <Icon className="h-3.5 w-3.5" />
      </StreamAction>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 top-9 z-50 w-44 animate-rise rounded-lg border border-base-700 bg-base-900 p-2.5 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-ink-300">Audio da tela</span>
              <span className="font-mono text-[11px] tabular-nums text-ink-500">
                {Math.round(volume * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(volume * 100)}
              onChange={(event) => change(Number(event.target.value) / 100)}
              aria-label="Volume do audio da tela"
              className="mt-1.5 w-full accent-accent-500"
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function StreamAction({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-md border backdrop-blur transition-colors",
        active
          ? "border-accent-600/60 bg-accent-600/20 text-accent-300"
          : "border-base-600 bg-base-900/80 text-ink-300 hover:bg-base-800 hover:text-ink-100",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Liga uma faixa de video a um <video>.
 *
 * `attach`/`detach` sao do LiveKit; o React so cuida do elemento. Trocar de
 * faixa sem desanexar a anterior deixa a antiga rodando invisivel, consumindo
 * banda e CPU — por isso a limpeza acontece no retorno do efeito.
 */
function TrackVideo({
  track,
  className,
  onElement,
}: {
  track: Track;
  className?: string;
  onElement?: (element: HTMLVideoElement | null) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    onElement?.(element);
    return () => {
      track.detach(element);
      onElement?.(null);
    };
    // `onElement` e uma closure nova a cada render; incluir na lista
    // reanexaria a faixa sem necessidade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      // Sem isto o navegador reproduz o audio da tela duas vezes: uma pelo
      // elemento de audio da sala e outra por aqui.
      muted
      className={className}
    />
  );
}
