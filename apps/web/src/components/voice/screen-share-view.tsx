"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AetherIcon, type AetherIconName } from "@/components/ui/aether-icon";
import type { Track } from "livekit-client";
import { useRealtimeStore, useScreenShares } from "@/lib/stores/realtime-store";
import {
  DEFAULT_VOLUME,
  readScreenVolume,
  saveScreenVolume,
} from "@/lib/voice/volumes";
import { VolumeSlider } from "@/components/ui/volume-slider";
import { mediaLog } from "@/lib/voice/debug";
import { cn } from "@/lib/utils";

/**
 * Area de compartilhamento de tela.
 *
 * Layout: um stream em DESTAQUE ocupando a area principal, miniaturas dos
 * demais embaixo. Clicar numa miniatura troca o destaque; o alfinete fixa.
 *
 * NOVO: da para MINIMIZAR a tela em destaque. Minimizada, a grade de
 * participantes volta a ser o assunto (para ver as cameras dos amigos), e a
 * tela vira um bloco flutuante no canto — `<ScreenShareMini>`, renderizado pelo
 * `voice-stage`. Um clique com o botao direito na tela abre um menu no ponto do
 * cursor com minimizar, volume, fixar, PiP e tela cheia.
 *
 * NADA de outra pessoa comeca a tocar sem voce aceitar (`Convite`). A SUA
 * propria transmissao e a excecao — ver o que voce mesmo envia e conferencia.
 */

/** Faixas de tela ativas (a propria + as dos outros), na ordem de exibicao. */
function useSharesList() {
  const shares = useScreenShares();
  const localTrack = useRealtimeStore((state) => state.localShareTrack);
  const localSharing = useRealtimeStore((state) => state.localSharing);
  const selfUserId = useRealtimeStore((state) => state.selfUserId);

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
  return { all, selfUserId };
}

export function ScreenShareView({ onMinimizar }: { onMinimizar: () => void }) {
  const { all, selfUserId } = useSharesList();
  const focusedId = useRealtimeStore((state) => state.focusedShareUserId);
  const setFocusedShare = useRealtimeStore((state) => state.setFocusedShare);
  const watched = useRealtimeStore((state) => state.watchedShares);
  const watchShare = useRealtimeStore((state) => state.watchShare);

  if (all.length === 0) return null;

  const focused = all.find((item) => item.userId === focusedId) ?? all[0];
  if (!focused) return null;
  const others = all.filter((item) => item.userId !== focused.userId);

  const podeVer = (userId: string) =>
    userId === selfUserId || watched.includes(userId);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
      {podeVer(focused.userId) ? (
        <FocusedStream
          label={focused.label}
          track={focused.track}
          pinned={focusedId === focused.userId}
          onTogglePin={() =>
            setFocusedShare(
              focusedId === focused.userId ? null : focused.userId,
            )
          }
          onMinimizar={onMinimizar}
        />
      ) : (
        <Convite
          label={focused.label}
          onAceitar={() => watchShare(focused.userId)}
        />
      )}

      {others.length > 0 ? (
        <div className="flex shrink-0 gap-2 overflow-x-auto pb-1">
          {others.map((item) => (
            <button
              key={item.userId}
              type="button"
              onClick={() => setFocusedShare(item.userId)}
              title={`Ver a tela de ${item.label}`}
              className="group relative aspect-video w-40 shrink-0 overflow-hidden rounded-md border border-line bg-base-950 transition-colors hover:border-accent-600/60"
            >
              {podeVer(item.userId) ? (
                <TrackVideo
                  track={item.track}
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="grid h-full w-full place-items-center">
                  <AetherIcon
                    name="screen-share"
                    className="h-5 w-5 text-ink-500"
                  />
                </span>
              )}
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

/**
 * A tela minimizada — bloco flutuante no canto. Clicar restaura o destaque.
 * Segue mostrando o video (pequeno) para nao "perder" o que a pessoa mostra.
 */
export function ScreenShareMini({ onRestaurar }: { onRestaurar: () => void }) {
  const { all, selfUserId } = useSharesList();
  const focusedId = useRealtimeStore((state) => state.focusedShareUserId);
  const watched = useRealtimeStore((state) => state.watchedShares);
  const watchShare = useRealtimeStore((state) => state.watchShare);

  if (all.length === 0) return null;
  const focused = all.find((item) => item.userId === focusedId) ?? all[0];
  if (!focused) return null;
  const podeVer =
    focused.userId === selfUserId || watched.includes(focused.userId);

  return (
    <div className="pointer-events-auto absolute bottom-24 right-4 z-20 w-[clamp(200px,26vw,320px)] overflow-hidden rounded-lg border border-line-strong bg-base-950 shadow-[var(--shadow-pop)]">
      <button
        type="button"
        onClick={onRestaurar}
        title="Voltar a ver a tela em destaque"
        className="group relative block aspect-video w-full"
      >
        {podeVer ? (
          <TrackVideo
            track={focused.track}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="grid h-full w-full place-items-center bg-base-900">
            <AetherIcon name="screen-share" className="h-6 w-6 text-ink-500" />
          </span>
        )}
        <span className="absolute inset-0 grid place-items-center bg-base-950/0 opacity-0 transition-opacity group-hover:bg-base-950/40 group-hover:opacity-100">
          <span className="flex items-center gap-1.5 rounded-md border border-line-strong bg-base-900/90 px-2.5 py-1.5 text-[12px] font-medium text-ink-100">
            <AetherIcon name="maximize" className="h-3.5 w-3.5" />
            Expandir
          </span>
        </span>
      </button>
      <div className="flex items-center gap-1.5 border-t border-line px-2.5 py-1.5">
        <AetherIcon
          name="screen-share"
          className="h-3.5 w-3.5 shrink-0 text-signal-live"
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-300">
          {focused.label}
        </span>
        {!podeVer ? (
          <button
            type="button"
            onClick={() => watchShare(focused.userId)}
            className="shrink-0 rounded-sm bg-accent-500 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-accent-400"
          >
            Assistir
          </button>
        ) : null}
      </div>
    </div>
  );
}

function FocusedStream({
  label,
  track,
  pinned,
  onTogglePin,
  onMinimizar,
}: {
  label: string;
  track: Track;
  pinned: boolean;
  onTogglePin: () => void;
  onMinimizar: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [pipAvailable, setPipAvailable] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setPipAvailable(
      typeof document !== "undefined" && document.pictureInPictureEnabled,
    );
  }, []);

  async function toggleFullscreen() {
    const element = containerRef.current;
    if (!element) return;
    try {
      if (document.fullscreenElement === element) {
        await document.exitFullscreen();
        return;
      }
      await element.requestFullscreen();
    } catch (error) {
      mediaLog("tela cheia recusada", error);
    }
  }

  async function togglePip() {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      await video.requestPictureInPicture();
    } catch (error) {
      mediaLog("picture-in-picture recusado", error);
    }
  }

  return (
    <div
      ref={containerRef}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      className="group/stream relative min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-base-950"
    >
      <TrackVideo
        track={track}
        onElement={(element) => (videoRef.current = element)}
        className="h-full w-full object-contain"
      />

      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-sm border border-signal-live/40 bg-base-950/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-signal-live backdrop-blur">
        <AetherIcon name="screen-share" className="h-3 w-3" />
        {label}
      </div>

      {/*
        Botoes do canto: MAIORES (36px, icone 18px) e sempre um pouco visiveis
        — no toque nao ha hover, e escondidos atras dele nao davam para achar.
        Ganham opacidade cheia no hover / foco.
      */}
      <div className="absolute right-3 top-3 flex items-center gap-1.5 opacity-70 transition-opacity focus-within:opacity-100 group-hover/stream:opacity-100">
        <StreamAction label="Minimizar (ver a grade)" onClick={onMinimizar}>
          <AetherIcon name="chevron" className="h-[18px] w-[18px] -rotate-90" />
        </StreamAction>

        <StreamAction
          label={pinned ? "Desafixar destaque" : "Fixar este compartilhamento"}
          onClick={onTogglePin}
          active={pinned}
        >
          <AetherIcon
            name={pinned ? "pin-off" : "pin"}
            className="h-[18px] w-[18px]"
          />
        </StreamAction>

        {pipAvailable ? (
          <StreamAction
            label="Picture-in-picture"
            onClick={() => void togglePip()}
          >
            <AetherIcon name="pip" className="h-[18px] w-[18px]" />
          </StreamAction>
        ) : null}

        <ScreenAudioVolume />

        <StreamAction
          label="Tela cheia"
          onClick={() => void toggleFullscreen()}
        >
          <AetherIcon name="maximize" className="h-[18px] w-[18px]" />
        </StreamAction>
      </div>

      {menu ? (
        <MenuFlutuante
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          pinned={pinned}
          pipAvailable={pipAvailable}
          onMinimizar={onMinimizar}
          onTogglePin={onTogglePin}
          onPip={() => void togglePip()}
          onFullscreen={() => void toggleFullscreen()}
        />
      ) : null}
    </div>
  );
}

/**
 * Menu que abre no ponto do cursor ao clicar com o botao direito na tela.
 * Traz o volume do audio da tela inline (o pedido principal) + as mesmas
 * acoes do canto.
 */
function MenuFlutuante({
  x,
  y,
  onClose,
  pinned,
  pipAvailable,
  onMinimizar,
  onTogglePin,
  onPip,
  onFullscreen,
}: {
  x: number;
  y: number;
  onClose: () => void;
  pinned: boolean;
  pipAvailable: boolean;
  onMinimizar: () => void;
  onTogglePin: () => void;
  onPip: () => void;
  onFullscreen: () => void;
}) {
  const roomControls = useRealtimeStore((state) => state.roomControls);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: x,
    top: y,
  });

  useEffect(() => setVolume(readScreenVolume()), []);

  // Nao deixa o menu sair da janela.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      left: Math.min(x, window.innerWidth - w - 8),
      top: Math.min(y, window.innerHeight - h - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const t = setTimeout(() => document.addEventListener("mousedown", fora));
    document.addEventListener("keydown", esc);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  function mudarVolume(next: number) {
    setVolume(next);
    saveScreenVolume(next);
    roomControls?.setScreenAudioVolume(next);
  }

  const item =
    "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-[13px] text-ink-200 transition-colors hover:bg-base-800";

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[60] w-56 animate-rise rounded-lg border border-line-strong bg-base-900 p-1.5 shadow-[var(--shadow-pop)]"
    >
      <div className="px-2 pb-1.5 pt-1">
        <div className="flex items-center justify-between text-[11px] text-ink-400">
          <span className="flex items-center gap-1.5">
            <AetherIcon
              name={volume === 0 ? "volume-off" : "volume"}
              className="h-3.5 w-3.5"
            />
            Volume da tela
          </span>
          <span className="font-mono tabular-nums text-ink-500">
            {Math.round(volume * 100)}%
          </span>
        </div>
        <VolumeSlider
          value={volume}
          onChange={mudarVolume}
          label="Volume do audio da tela"
          className="mt-2"
        />
      </div>

      <div className="my-1 border-t border-line" />

      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => {
          onMinimizar();
          onClose();
        }}
      >
        <AetherIcon name="chevron" className="h-4 w-4 -rotate-90" />
        Minimizar — ver a grade
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => {
          onTogglePin();
          onClose();
        }}
      >
        <AetherIcon name={pinned ? "pin-off" : "pin"} className="h-4 w-4" />
        {pinned ? "Desafixar destaque" : "Fixar este compartilhamento"}
      </button>
      {pipAvailable ? (
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            onPip();
            onClose();
          }}
        >
          <AetherIcon name="pip" className="h-4 w-4" />
          Picture-in-picture
        </button>
      ) : null}
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => {
          onFullscreen();
          onClose();
        }}
      >
        <AetherIcon name="maximize" className="h-4 w-4" />
        Tela cheia
      </button>
    </div>,
    document.body,
  );
}

/**
 * Volume do audio da tela — botao do canto (o menu do botao direito tem o
 * mesmo controle inline).
 */
function ScreenAudioVolume() {
  const roomControls = useRealtimeStore((state) => state.roomControls);
  const [open, setOpen] = useState(false);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);

  useEffect(() => setVolume(readScreenVolume()), []);

  function change(next: number) {
    setVolume(next);
    saveScreenVolume(next);
    roomControls?.setScreenAudioVolume(next);
  }

  const nomeVolume: AetherIconName = volume === 0 ? "volume-off" : "volume";

  return (
    <div className="relative">
      <StreamAction
        label={`Volume do audio da tela (${Math.round(volume * 100)}%)`}
        onClick={() => setOpen((value) => !value)}
        active={open}
      >
        <AetherIcon name={nomeVolume} className="h-[18px] w-[18px]" />
      </StreamAction>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 top-11 z-50 w-48 animate-rise rounded-lg border border-line bg-base-900 p-3 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-ink-300">Audio da tela</span>
              <span className="font-mono text-[11px] tabular-nums text-ink-500">
                {Math.round(volume * 100)}%
              </span>
            </div>
            <VolumeSlider
              value={volume}
              onChange={change}
              label="Volume do audio da tela"
              className="mt-2.5"
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
        "grid h-9 w-9 place-items-center rounded-md border backdrop-blur transition-colors active:scale-95",
        active
          ? "border-accent-600/60 bg-accent-600/25 text-accent-300"
          : "border-line-strong bg-base-900/80 text-ink-200 hover:bg-base-800 hover:text-ink-100",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Liga uma faixa de video a um <video>. `attach`/`detach` sao do LiveKit.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  return <video ref={ref} autoPlay playsInline muted className={className} />;
}

/**
 * O convite para assistir. Nao ha video rodando por tras dele.
 */
function Convite({
  label,
  onAceitar,
}: {
  label: string;
  onAceitar: () => void;
}) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center rounded-lg border border-line bg-base-950">
      <div className="flex max-w-sm flex-col items-center gap-4 p-8 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-base-850">
          <AetherIcon name="screen-share" className="h-6 w-6 text-accent-400" />
        </span>

        <div>
          <p className="text-[15px] font-bold text-ink-100">
            {label} esta compartilhando a tela
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-300">
            Nada abre sozinho aqui. Clique quando quiser ver.
          </p>
        </div>

        <button
          type="button"
          onClick={onAceitar}
          className="flex items-center gap-2 rounded-md bg-accent-500 px-4 py-2 text-[13px] font-bold text-white transition-colors duration-150 hover:bg-accent-400"
        >
          <AetherIcon name="play" className="h-4 w-4" />
          Assistir
        </button>
      </div>
    </div>
  );
}
