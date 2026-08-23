"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Clock,
  Gamepad2,
  Headphones,
  Mic,
  MicOff,
  MonitorUp,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { PublicChannel, PublicUser, UserStatus } from "@aether/shared";
import { useSocket } from "@/components/realtime/realtime-provider";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * AETHER Activity — o cartao de perfil com o que a pessoa esta fazendo agora.
 *
 * Nao existe um "objeto de presenca" novo por tras disto de proposito. Tudo
 * que aparece aqui ja viajava em tempo real: `presence` da o online/ausente e
 * `voice` da canal, mudo, surdo, tela e falando. Inventar uma segunda fonte
 * para os mesmos fatos criaria duas verdades sobre a mesma pessoa — e quando
 * elas divergissem, nao haveria qual acreditar.
 *
 * Por isso o cartao le da store a CADA render em vez de receber um retrato
 * congelado: com ele aberto, a pessoa entrar num canal, mutar ou comecar a
 * transmitir muda o que esta na tela na hora.
 *
 * O unico dado novo e o `joinedAt`, carimbado pelo gateway — relogio de
 * navegador erra, e um cliente poderia dizer que esta ali ha oito horas.
 */

export interface CardAnchor {
  x: number;
  y: number;
}

const CARD_WIDTH = 272;
/** Margem para o cartao nunca encostar na borda da janela. */
const EDGE_GAP = 8;

const STATUS_LABEL: Record<UserStatus, string> = {
  ONLINE: "Online",
  IDLE: "Ausente",
  DND: "Nao perturbe",
  OFFLINE: "Offline",
};

const STATUS_COLOR: Record<UserStatus, string> = {
  ONLINE: "bg-signal-online",
  IDLE: "bg-signal-idle",
  DND: "bg-signal-dnd",
  OFFLINE: "bg-ink-600",
};

/**
 * Ha quanto tempo, contado a partir do carimbo do servidor.
 *
 * Um intervalo de 1s so enquanto o cartao esta aberto: e um contador visivel,
 * e parar de contar enquanto alguem olha seria pior que nao mostrar.
 */
function useElapsed(startedAt: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;

  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  // Abaixo de uma hora o campo de hora so ocuparia espaco dizendo "00".
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(rest)}`
    : `${pad(minutes)}:${pad(rest)}`;
}

export function UserActivityCard({
  user,
  nickname,
  serverName,
  voiceChannels,
  anchor,
  onClose,
}: {
  user: PublicUser;
  /** apelido no servidor aberto; o cartao mostra o apelido e o nome real */
  nickname?: string | null;
  serverName: string;
  voiceChannels: PublicChannel[];
  anchor: CardAnchor;
  onClose: () => void;
}) {
  const socket = useSocket();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(anchor);

  const presence = useRealtimeStore((state) => state.presence);
  const activity = useRealtimeStore((state) => state.activity);
  const voice = useRealtimeStore((state) => state.voice);
  const selfUserId = useRealtimeStore((state) => state.selfUserId);
  const setMedia = useRealtimeStore((state) => state.setMedia);
  const setVoiceError = useRealtimeStore((state) => state.setVoiceError);

  const status = presence[user.id] ?? "OFFLINE";
  const participant = voice[user.id] ?? null;
  const channel = participant?.channelId
    ? (voiceChannels.find((item) => item.id === participant.channelId) ?? null)
    : null;

  // Quantos dividem o canal — derivado da mesma store, sem pedir nada a mais.
  const inChannel = participant?.channelId
    ? Object.values(voice).filter(
        (item) => item.channelId === participant.channelId,
      ).length
    : 0;

  const elapsed = useElapsed(participant?.joinedAt ?? null);

  const game = activity[user.id] ?? null;
  const gameElapsed = useElapsed(game?.since ?? null);

  /**
   * Reposiciona depois de medir: perto da borda o cartao sairia da tela.
   * `useLayoutEffect` para o ajuste acontecer antes da pintura — senao ele
   * pisca na posicao errada.
   */
  useLayoutEffect(() => {
    const element = cardRef.current;
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
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const muted = participant
    ? participant.selfMuted || participant.serverMuted
    : false;
  const deafened = participant
    ? participant.selfDeafened || participant.serverDeafened
    : false;

  /**
   * A atividade e a coisa MAIS especifica que sabemos, nao a soma de tudo:
   * "compartilhando" ja implica estar em chamada, e listar os dois viraria
   * ruido em vez de informacao.
   */
  const estado = participant?.streaming
    ? { icon: MonitorUp, label: "Compartilhando a tela", tone: "text-signal-live" }
    : participant?.speaking && !muted
      ? { icon: Mic, label: "Falando", tone: "text-accent-300" }
      : participant
        ? { icon: Headphones, label: "Em chamada", tone: "text-ink-200" }
        : status === "OFFLINE"
          ? null
          : { icon: null, label: "No AETHER", tone: "text-ink-400" };

  const isSelf = user.id === selfUserId;
  const selfVoice = selfUserId ? (voice[selfUserId] ?? null) : null;
  const canJoin =
    !isSelf &&
    channel !== null &&
    selfVoice?.channelId !== channel.id &&
    socket !== null;

  function joinChannel() {
    if (!socket || !channel) return;
    socket.emit("voice:join", { channelId: channel.id }, (result) => {
      if (!result.ok) {
        setVoiceError(result.error);
        return;
      }
      setVoiceError(null);
      setMedia(result.media);
      onClose();
    });
  }

  if (typeof document === "undefined") return null;

  const EstadoIcon = estado?.icon ?? null;

  return createPortal(
    <>
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="fixed inset-0 z-[60] cursor-default"
      />
      <div
        ref={cardRef}
        style={{ left: position.x, top: position.y, width: CARD_WIDTH }}
        className="fixed z-[61] animate-rise overflow-hidden rounded-lg border border-base-700 bg-base-900 shadow-xl"
      >
        {/* Faixa superior: so cor, para o avatar ter onde se apoiar. */}
        <div className="h-12 bg-gradient-to-r from-accent-700/40 to-accent-500/20" />

        <div className="px-3.5 pb-3.5">
          <div className="-mt-6 mb-2.5">
            <Avatar
              userId={user.id}
              name={nickname ?? user.displayName}
              src={user.avatarUrl}
              status={status}
              size="lg"
            />
          </div>

          <p className="truncate text-[15px] font-semibold text-ink-100">
            {nickname ?? user.displayName}
          </p>
          <p className="truncate font-mono text-[11px] text-ink-500">
            @{user.username}
            {/* Com apelido, o nome real deixa de aparecer em qualquer lugar. */}
            {nickname ? ` · ${user.displayName}` : ""}
          </p>

          <div className="mt-2 flex items-center gap-1.5">
            <span
              className={cn("h-2 w-2 rounded-full", STATUS_COLOR[status])}
              aria-hidden
            />
            <span className="text-[12px] text-ink-300">
              {STATUS_LABEL[status]}
            </span>
          </div>

          {estado || game ? (
            <div className="mt-3 border-t border-base-800 pt-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
                atividade
              </p>

              {/*
                O jogo vem PRIMEIRO, e nao junto do estado de voz: e o dado
                mais especifico sobre a pessoa. "Em chamada" muita gente esta;
                "jogando Hollow Knight" e o que diz o que ela esta fazendo.
              */}
              {game ? (
                <div className="mb-2 flex items-start gap-2">
                  <ArteDoJogo cover={game.cover} icon={game.icon} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-ink-100">
                      Jogando {game.game}
                    </p>
                    {gameElapsed ? (
                      <p className="flex items-center gap-1 text-[11px] tabular-nums text-ink-500">
                        <Clock className="h-3 w-3 shrink-0" />
                        {gameElapsed}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {estado ? (
              <div className="mt-1.5 flex items-center gap-1.5">
                {EstadoIcon ? (
                  <EstadoIcon
                    className={cn("h-3.5 w-3.5 shrink-0", estado.tone)}
                  />
                ) : null}
                <span className={cn("text-[13px]", estado.tone)}>
                  {estado.label}
                </span>
                {muted ? (
                  <MicOff
                    className="h-3 w-3 shrink-0 text-signal-dnd"
                    aria-label="Mutado"
                  />
                ) : null}
                {deafened ? (
                  <VolumeX
                    className="h-3 w-3 shrink-0 text-signal-dnd"
                    aria-label="Surdo"
                  />
                ) : null}
              </div>
              ) : null}

              {channel ? (
                <>
                  <div className="mt-2 flex items-start gap-1.5">
                    <Volume2 className="mt-[3px] h-3.5 w-3.5 shrink-0 text-ink-500" />
                    <div className="min-w-0">
                      <p className="truncate text-[12px] text-ink-200">
                        {channel.name}
                      </p>
                      <p className="truncate text-[11px] text-ink-500">
                        {serverName}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-500">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3 shrink-0" />
                      {inChannel}
                      {channel.userLimit ? ` / ${channel.userLimit}` : ""}
                    </span>
                    {elapsed ? (
                      <span className="flex items-center gap-1 tabular-nums">
                        <Clock className="h-3 w-3 shrink-0" />
                        {elapsed}
                      </span>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {canJoin ? (
            <button
              type="button"
              onClick={joinChannel}
              className="mt-3 w-full rounded-md border border-accent-600/50 bg-accent-600/10 px-3 py-2 text-[12px] font-medium text-accent-300 transition-colors hover:bg-accent-600/20"
            >
              Entrar no canal
            </button>
          ) : null}
        </div>
      </div>
    </>,
    document.body,
  );
}

/**
 * A imagem do jogo, em cadeia de fallback.
 *
 *   1. capa do IGDB  — 264x374, arte de verdade
 *   2. icone do executavel — 48px, extraido na maquina de quem joga
 *   3. icone generico do AETHER
 *
 * O passo 3 nao e enfeite: e a garantia de que nunca aparece imagem quebrada.
 * E por isso a falha de CARREGAMENTO tambem cai na cadeia — uma capa que
 * responde 404 (o CDN mudou, a URL envelheceu no cache) e indistinguivel de
 * nao ter capa, do ponto de vista de quem esta olhando a tela.
 */
function ArteDoJogo({
  cover,
  icon,
}: {
  cover: string | null;
  icon: string | null;
}) {
  const [capaFalhou, setCapaFalhou] = useState(false);

  // Capa nova depois de uma que falhou merece nova chance.
  useEffect(() => setCapaFalhou(false), [cover]);

  if (cover && !capaFalhou) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- CDN externo, fora do otimizador
      <img
        src={cover}
        alt=""
        onError={() => setCapaFalhou(true)}
        className="h-14 w-10 shrink-0 rounded-[4px] object-cover"
      />
    );
  }

  if (icon) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- data URL, nao ha o que otimizar
      <img src={icon} alt="" className="h-8 w-8 shrink-0 rounded-[4px]" />
    );
  }

  return <Gamepad2 className="mt-[3px] h-3.5 w-3.5 shrink-0 text-accent-400" />;
}
