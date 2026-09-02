"use client";

import { useEffect, useRef, useState } from "react";
import type { Track } from "livekit-client";
import type { PublicChannel, VoiceParticipant } from "@aether/shared";
import { Avatar } from "@/components/ui/avatar";
import { AetherIcon } from "@/components/ui/aether-icon";
import { useSocket } from "@/components/realtime/realtime-provider";
import {
  useIsConnected,
  useMicTest,
  useRealtimeStore,
  useScreenShares,
  useSelfVoice,
  useVoiceParticipants,
} from "@/lib/stores/realtime-store";
import type { ConnectionStats } from "@/lib/voice/connection-stats";
import { startMicLevel, type MicLevelHandle } from "@/lib/voice/mic-level";
import { ScreenShareView } from "@/components/voice/screen-share-view";
import {
  VoiceMemberMenu,
  type MenuAnchor,
} from "@/components/voice/voice-member-menu";
import { useEntrarNaVoz } from "@/lib/voice/use-entrar-na-voz";
import { ConnectionPanel } from "@/components/voice/connection-panel";
import { cn } from "@/lib/utils";

/**
 * Palco do canal de voz — a area central.
 *
 * Cada participante ocupa um card. O card e o MESMO container que recebe o
 * <video> quando alguem liga a camera ou compartilha a tela: o avatar da lugar
 * ao stream sem trocar de layout. A grade e definida pela quantidade de
 * participantes.
 *
 * Identidade AETHER (redesign OpenDesign): cards com superficie elevada e anel
 * de atividade no avatar; "falando" e um glow azul que respira (`--glow-speak`),
 * nao uma borda verde grossa. Estados de risco (mudo) em `signal-dnd`;
 * ISOLAMENTO (teste de microfone) em `signal-isolate`.
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
  const connected = useIsConnected();
  const participants = useVoiceParticipants(channel.id);
  const selfVoice = useSelfVoice();
  const shares = useScreenShares();
  const localSharing = useRealtimeStore((state) => state.localSharing);

  const isHere = selfVoice?.channelId === channel.id;
  const [statsOpen, setStatsOpen] = useState(false);
  const statsButtonRef = useRef<HTMLButtonElement>(null);
  const full =
    channel.userLimit !== null &&
    participants.length >= channel.userLimit &&
    !isHere;
  const blocked = !connected || !canConnect || full;
  const limitLabel = channel.userLimit ? ` / ${channel.userLimit}` : "";

  /**
   * A mesma entrada usada pelo clique no canal, na barra lateral. Duas copias
   * do `voice:join` divergiriam, e o ack e quem traz as credenciais de midia.
   */
  const { entrar, sair } = useEntrarNaVoz();

  function toggleConnection() {
    if (isHere) sair();
    else entrar(channel.id);
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
          <AetherIcon name="disconnect" size="sm" />
          Desconectar
        </>
      ) : (
        <>
          <AetherIcon name="voice" size="sm" />
          {full ? "Canal cheio" : "Conectar"}
        </>
      )}
    </button>
  );

  if (participants.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <div className="grid h-16 w-16 place-items-center rounded-lg border border-base-700 bg-base-900">
          <AetherIcon name="voice" size="lg" className="text-ink-500" />
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
   * participantes descem para uma faixa compacta.
   */
  const sharing = shares.length > 0 || localSharing;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* faixa de conexao persistente — so na call */}
      {isHere ? (
        <FaixaDeConexao
          channelName={channel.name}
          onAbrirPainel={() => setStatsOpen((v) => !v)}
          painelAberto={statsOpen}
          botaoRef={statsButtonRef}
        />
      ) : null}

      <div className="flex shrink-0 items-center justify-between px-4 pt-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-500">
          {participants.length} conectado{participants.length > 1 ? "s" : ""}
          {limitLabel}
        </span>
        {!isHere ? action : null}
      </div>

      {statsOpen && statsButtonRef.current ? (
        <ConnectionPanel
          anchorEl={statsButtonRef.current}
          onClose={() => setStatsOpen(false)}
        />
      ) : null}

      {/* faixa vermelha de isolamento — teste de microfone ativo */}
      {isHere ? <MonitorStrip /> : null}

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
            sharing
              ? "flex gap-2"
              : "grid gap-4 grid-cols-[repeat(auto-fit,minmax(230px,1fr))]",
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

/**
 * Faixa fina "Voz conectada" acima da grade. Le o mesmo `subscribeConnectionStats`
 * do painel completo — o numero de ping resumido aparece aqui, o detalhe (perda,
 * regiao, sparkline) continua no `ConnectionPanel`, aberto pelo botao de sinal.
 */
function FaixaDeConexao({
  channelName,
  onAbrirPainel,
  painelAberto,
  botaoRef,
}: {
  channelName: string;
  onAbrirPainel: () => void;
  painelAberto: boolean;
  botaoRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const subscribe = useRealtimeStore(
    (state) => state.roomControls?.subscribeConnectionStats,
  );
  const [stats, setStats] = useState<ConnectionStats | null>(null);

  useEffect(() => {
    if (!subscribe) return;
    return subscribe(setStats);
  }, [subscribe]);

  const ping = stats?.rttMs ?? null;
  const ruim = stats?.quality === "ruim";

  return (
    <div
      data-od-id="voice-connection"
      className={cn(
        "mx-4 mt-3 flex items-center gap-3 rounded-md border px-3.5 py-2.5",
        ruim
          ? "border-signal-dnd/25 bg-signal-dnd/10"
          : "border-signal-online/25 bg-gradient-to-b from-signal-online/[0.12] to-base-850",
      )}
    >
      <AetherIcon
        name="signal"
        size="sm"
        className={ruim ? "text-signal-dnd" : "text-signal-online"}
      />
      <span className="min-w-0 leading-tight">
        <b
          className={cn(
            "block text-[13px] font-semibold",
            ruim ? "text-signal-dnd" : "text-signal-online",
          )}
        >
          {ruim ? "Conexao instavel" : "Voz conectada"}
        </b>
        <span className="block truncate text-[11px] text-ink-400">
          {channelName}
        </span>
      </span>
      <span className="ml-auto flex items-center gap-2">
        {ping != null ? (
          <span
            className={cn(
              "font-mono text-[11px]",
              ping >= 250 ? "text-signal-dnd" : "text-ink-400",
            )}
          >
            {ping}&nbsp;ms
          </span>
        ) : null}
        <button
          ref={botaoRef}
          type="button"
          aria-label="Detalhes da conexao"
          onClick={onAbrirPainel}
          className={cn(
            "rounded-md border border-base-700 p-1.5 text-ink-400 transition-colors hover:bg-base-800 hover:text-ink-200",
            painelAberto && "bg-base-800 text-ink-200",
          )}
        >
          <AetherIcon name="activity" size="sm" />
        </button>
      </span>
    </div>
  );
}

/**
 * Faixa de ISOLAMENTO — aparece quando o teste de microfone esta ativo.
 * O audio NAO vai para a call: `startMicLevel` abre um stream local proprio,
 * so para desenhar o medidor.
 */
function MonitorStrip() {
  const micTest = useMicTest();
  const setMicTest = useRealtimeStore((state) => state.setMicTest);
  const [level, setLevel] = useState(0);
  const handleRef = useRef<MicLevelHandle | null>(null);

  useEffect(() => {
    if (!micTest) return;
    let cancelado = false;
    void (async () => {
      try {
        const handle = await startMicLevel({ onLevel: (l) => !cancelado && setLevel(l) });
        if (cancelado) handle.stop();
        else handleRef.current = handle;
      } catch {
        if (!cancelado) setMicTest(false);
      }
    })();
    return () => {
      cancelado = true;
      handleRef.current?.stop();
      handleRef.current = null;
      setLevel(0);
    };
  }, [micTest, setMicTest]);

  if (!micTest) return null;

  return (
    <div
      data-od-id="monitor-strip"
      className="mx-4 mt-3 flex items-center gap-3 rounded-md border border-signal-isolate/35 bg-signal-isolate/[0.12] px-3.5 py-2.5"
    >
      <AetherIcon name="headset-off" size="lg" className="text-signal-isolate" />
      <span className="min-w-0 leading-tight">
        <b className="block text-[12.5px] font-semibold text-signal-isolate-ink">
          Ouvindo a propria voz — modo teste
        </b>
        <span className="block text-[11px] text-ink-400">
          Seu microfone esta sendo monitorado so para voce. Ninguem na call recebe este audio.
        </span>
      </span>
      <span className="ml-auto flex h-5 items-end gap-[3px]" aria-hidden>
        {Array.from({ length: 16 }, (_, i) => (
          <i
            key={i}
            style={{ height: `${6 + i * 0.8}px` }}
            className={cn(
              "w-1 -skew-x-12 rounded-[1px] transition-colors duration-75",
              level * 16 > i ? "bg-signal-isolate" : "bg-base-750",
            )}
          />
        ))}
      </span>
      <button
        type="button"
        onClick={() => setMicTest(false)}
        className="shrink-0 rounded-md border border-signal-isolate/40 bg-signal-isolate/15 px-2.5 py-1 text-[12px] font-medium text-signal-isolate-ink transition-colors hover:bg-signal-isolate/25"
      >
        Parar teste
      </button>
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
  const micTest = useMicTest();
  const isTesting = isSelf && micTest;
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);

  /**
   * A camera de quem esta neste bloco: a propria vem do estado local, a dos
   * outros vem da sala. So desenhamos se o participante TAMBEM se anuncia com
   * a camera ligada.
   */
  const cameras = useRealtimeStore((estado) => estado.cameras);
  const minhaCamera = useRealtimeStore((estado) => estado.localCameraTrack);
  const faixa = !participant.camera
    ? null
    : isSelf
      ? minhaCamera
      : (cameras.find((c) => c.userId === participant.userId)?.track ?? null);

  /**
   * Clique direito no card abre o volume. O menu do proprio card nao abre — nao
   * se regula o proprio microfone.
   */
  function openMenu(event: React.MouseEvent) {
    if (isSelf) return;
    event.preventDefault();
    setMenuAnchor({ x: event.clientX, y: event.clientY });
  }

  const temMidia = Boolean(faixa) || (isSelf && participant.streaming);

  return (
    <div
      onContextMenu={openMenu}
      data-od-id={`peer-${participant.userId}`}
      className={cn(
        "group relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border bg-base-850 p-4 transition-[border-color,box-shadow,background-color,transform] duration-200",
        compact ? "aspect-square w-32 shrink-0 gap-1.5 p-2" : "aspect-[4/3]",
        !isSelf && "cursor-context-menu",
        !compact && "hover:-translate-y-px",
        isTesting
          ? "border-signal-isolate/50 bg-signal-isolate/[0.05] isolate-ring"
          : speaking
            ? "border-accent-500/55 bg-accent-500/[0.06] speaking-ring"
            : "border-base-700",
      )}
    >
      {menuAnchor ? (
        <VoiceMemberMenu
          participant={participant}
          anchor={menuAnchor}
          onClose={() => setMenuAnchor(null)}
        />
      ) : null}

      {/* Com camera/tela, o video OCUPA o bloco e o avatar sai. */}
      {faixa ? (
        <CameraVideo track={faixa} espelhar={isSelf} />
      ) : (
        <div className="relative">
          <Avatar
            userId={participant.userId}
            name={participant.user.displayName}
            src={participant.user.avatarUrl}
            moldura={participant.user.moldura}
            size={compact ? "sm" : "lg"}
            speaking={speaking && !isTesting}
            className={cn(
              isTesting && "opacity-70 grayscale",
              muted && !isTesting && "opacity-80 saturate-50",
            )}
          />
          {/* anel de atividade em volta do avatar */}
          {speaking && !isTesting ? (
            <span
              aria-hidden
              className="pointer-events-none absolute -inset-1.5 rounded-full border-2 border-accent-500/70"
            />
          ) : null}
          {isTesting ? (
            <span
              aria-hidden
              className="pointer-events-none absolute -inset-1.5 grid place-items-center rounded-full border-2 border-signal-isolate/60"
            >
              <AetherIcon
                name="headset-off"
                className="h-2/3 w-2/3 text-signal-isolate drop-shadow"
              />
            </span>
          ) : null}
        </div>
      )}

      {/* selo de canto — mudo / isolado / ao vivo */}
      {isTesting ? (
        <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full border border-signal-isolate/40 bg-base-950/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-signal-isolate-ink backdrop-blur-sm">
          <AetherIcon name="headset-off" size="sm" />
          Isolado
        </span>
      ) : muted && !faixa ? (
        <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full border border-signal-dnd/35 bg-base-950/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-signal-dnd backdrop-blur-sm">
          <AetherIcon name="mic-off" size="sm" />
          Mudo
        </span>
      ) : null}

      {participant.streaming ? (
        <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-signal-live/40 bg-signal-live/[0.16] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-[#ff9ea0] backdrop-blur-sm">
          <AetherIcon name="screen-share" size="sm" />
          Ao vivo
        </span>
      ) : null}

      {/* nome + linha de estado (sobre o video, quando ha) */}
      {temMidia || compact ? (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-base-950/90 to-transparent px-3 py-2.5">
          <span className="truncate font-mono text-[11px] text-ink-200">
            {participant.user.displayName}
            {isSelf ? <span className="text-ink-500"> · voce</span> : null}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            {deafened ? (
              <AetherIcon name="volume-off" size="sm" className="text-signal-dnd" />
            ) : null}
            {muted ? (
              <AetherIcon name="mic-off" size="sm" className="text-signal-dnd" />
            ) : null}
          </span>
        </div>
      ) : (
        <>
          <div
            className={cn(
              "relative z-[1] flex items-center gap-2 text-[13.5px] font-semibold tracking-[-0.01em]",
              speaking && !isTesting ? "text-ink-100" : "text-ink-200",
            )}
          >
            {participant.user.displayName}
            {isSelf ? (
              <span className="text-[11px] font-normal text-ink-500">(voce)</span>
            ) : null}
          </div>
          <div
            className={cn(
              "relative z-[1] flex items-center gap-1.5 text-[11px]",
              isTesting
                ? "text-signal-isolate-ink"
                : muted
                  ? "text-signal-dnd"
                  : speaking
                    ? "text-accent-300"
                    : "text-ink-400",
            )}
          >
            <AetherIcon
              name={
                isTesting
                  ? "headset-off"
                  : deafened
                    ? "volume-off"
                    : muted
                      ? "mic-off"
                      : speaking
                        ? "volume"
                        : "mic"
              }
              size="sm"
            />
            {isTesting
              ? "Ouvindo a propria voz"
              : deafened
                ? "Audio desativado"
                : muted
                  ? "Microfone desligado"
                  : speaking
                    ? "Falando"
                    : "Conectado"}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * O <video> de uma camera.
 *
 * `attach`/`detach` do LiveKit em vez de `srcObject` na mao: e o proprio
 * cliente que cuida de reassinar a faixa quando a qualidade muda.
 *
 * A PROPRIA camera aparece espelhada; a dos OUTROS nunca.
 */
function CameraVideo({
  track,
  espelhar,
}: {
  track: Track;
  espelhar: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const elemento = ref.current;
    if (!elemento) return;
    track.attach(elemento);
    return () => {
      track.detach(elemento);
    };
  }, [track]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      /** A propria camera vai MUDA: ouvir o proprio microfone e eco. */
      muted
      className={cn(
        "absolute inset-0 h-full w-full object-cover",
        espelhar && "-scale-x-100",
      )}
    />
  );
}
