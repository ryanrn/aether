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
  useVoiceLevel,
  useVoiceParticipants,
} from "@/lib/stores/realtime-store";
import type { ConnectionStats } from "@/lib/voice/connection-stats";
import { startMicLevel, type MicLevelHandle } from "@/lib/voice/mic-level";
import {
  listMicrophones,
  listSpeakers,
  readPreferredMicrophone,
  readPreferredSpeaker,
  savePreferredMicrophone,
  savePreferredSpeaker,
  type AudioDevice,
} from "@/lib/voice/devices";
import {
  ScreenShareMini,
  ScreenShareView,
} from "@/components/voice/screen-share-view";
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
  /**
   * Tela em destaque minimizada: a grade de participantes volta a ser o
   * assunto (para ver as cameras dos amigos) e a tela vira um bloco flutuante
   * no canto. Volta ao normal quando ninguem esta mais transmitindo.
   */
  const [telaMinimizada, setTelaMinimizada] = useState(false);
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
        <div className="grid h-16 w-16 place-items-center rounded-lg border border-line bg-base-900">
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
   * participantes descem para uma faixa compacta — a nao ser que a tela
   * esteja minimizada, ai a grade volta ao normal e a tela flutua no canto.
   */
  const sharing = shares.length > 0 || localSharing;
  const telaEmFoco = sharing && !telaMinimizada;

  // Ninguem mais transmitindo: volta ao estado normal para a proxima vez.
  useEffect(() => {
    if (!sharing && telaMinimizada) setTelaMinimizada(false);
  }, [sharing, telaMinimizada]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
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

      {telaEmFoco ? (
        <ScreenShareView onMinimizar={() => setTelaMinimizada(true)} />
      ) : null}

      {sharing && telaMinimizada ? (
        <ScreenShareMini onRestaurar={() => setTelaMinimizada(false)} />
      ) : null}

      <div
        className={cn(
          telaEmFoco
            ? "shrink-0 overflow-x-auto px-4 pb-4"
            : "flex-1 overflow-y-auto p-4",
        )}
      >
        <div
          className={cn(
            telaEmFoco
              ? "flex gap-2"
              : /*
                 `auto-fill` + teto de 300px por coluna: com 1-2 participantes o
                 card NAO estica para a largura toda (o que, com `aspect-[4/3]`,
                 gerava um card gigante e barra de rolagem). `justify-center`
                 centra quando ha poucos; `content-start` cola no topo.
                */
                "grid gap-4 grid-cols-[repeat(auto-fill,minmax(200px,300px))] justify-center content-start",
          )}
        >
          {participants.map((participant) => (
            <ParticipantCard
              key={participant.userId}
              participant={participant}
              isSelf={participant.userId === selfUserId}
              compact={telaEmFoco}
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
            "rounded-md border border-line p-1.5 text-ink-400 transition-colors hover:bg-base-800 hover:text-ink-200",
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
 * Faixa de ISOLAMENTO — teste de microfone ativo.
 *
 * O audio NAO vai para a call — `startMicLevel({ monitor: true })` abre um
 * stream local proprio e TOCA de volta para a pessoa se ouvir. Nada e
 * transmitido nem gravado. Seletores compactos trocam o microfone (entrada) e
 * o fone (saida) na hora, guardando a MESMA preferencia da call e das
 * Configuracoes.
 */
function MonitorStrip() {
  const micTest = useMicTest();
  const setMicTest = useRealtimeStore((state) => state.setMicTest);
  const [level, setLevel] = useState(0);
  const [mics, setMics] = useState<AudioDevice[]>([]);
  const [saidas, setSaidas] = useState<AudioDevice[]>([]);
  const [micId, setMicId] = useState<string | null>(null);
  const [saidaId, setSaidaId] = useState<string | null>(null);
  const handleRef = useRef<MicLevelHandle | null>(null);

  useEffect(() => {
    setMicId(readPreferredMicrophone());
    setSaidaId(readPreferredSpeaker());
  }, []);

  useEffect(() => {
    if (!micTest) return;
    void listMicrophones().then(setMics);
    void listSpeakers().then(setSaidas);
  }, [micTest]);

  // (re)abre o monitoramento quando liga ou quando troca o MICROFONE. Trocar
  // so o fone nao reabre nada — vai por `setOutput` abaixo.
  useEffect(() => {
    if (!micTest) return;
    let cancelado = false;
    handleRef.current?.stop();
    handleRef.current = null;
    void (async () => {
      try {
        const handle = await startMicLevel({
          deviceId: micId ?? undefined,
          monitor: true,
          outputDeviceId: readPreferredSpeaker(),
          onLevel: (l) => !cancelado && setLevel(l),
        });
        if (cancelado) handle.stop();
        else {
          handleRef.current = handle;
          void listMicrophones().then((d) => !cancelado && setMics(d));
          void listSpeakers().then((d) => !cancelado && setSaidas(d));
        }
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
  }, [micTest, micId, setMicTest]);

  if (!micTest) return null;

  function trocarMic(deviceId: string) {
    setMicId(deviceId);
    savePreferredMicrophone(deviceId);
  }
  function trocarSaida(deviceId: string) {
    setSaidaId(deviceId);
    savePreferredSpeaker(deviceId);
    void handleRef.current?.setOutput(deviceId);
  }

  return (
    <div
      data-od-id="monitor-strip"
      className="mx-4 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-signal-isolate/35 bg-signal-isolate/[0.12] px-3.5 py-2.5"
    >
      <AetherIcon
        name="headset-monitor"
        size="lg"
        className="text-signal-isolate"
      />
      <span className="min-w-0 flex-1 leading-tight">
        <b className="block text-[12.5px] font-semibold text-signal-isolate-ink">
          Ouvindo a propria voz — modo teste
        </b>
        <span className="block text-[11px] text-ink-400">
          Voce se ouve so para ajustar o microfone. Ninguem na call recebe este
          audio. Use fones para evitar eco.
        </span>
      </span>

      {mics.length > 1 ? (
        <label
          className="flex items-center gap-1.5 text-[11px] text-ink-400"
          title="Microfone"
        >
          <AetherIcon name="mic" size="sm" className="shrink-0 text-ink-500" />
          <select
            value={micId ?? ""}
            onChange={(e) => trocarMic(e.target.value)}
            className="max-w-[150px] truncate rounded-sm border border-line bg-base-900 px-1.5 py-1 text-[11px] text-ink-200"
          >
            {mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {saidas.length > 1 ? (
        <label
          className="flex items-center gap-1.5 text-[11px] text-ink-400"
          title="Fone / alto-falante"
        >
          <AetherIcon
            name="headset"
            size="sm"
            className="shrink-0 text-ink-500"
          />
          <select
            value={saidaId ?? ""}
            onChange={(e) => trocarSaida(e.target.value)}
            className="max-w-[150px] truncate rounded-sm border border-line bg-base-900 px-1.5 py-1 text-[11px] text-ink-200"
          >
            <option value="">Padrao do sistema</option>
            {saidas.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <span className="flex h-5 items-end gap-[3px]" aria-hidden>
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
   * Nivel de audio real (0..1) para dar intensidade ao glow. `nivel * 3.2`
   * porque voz normal fica na casa de 0,05–0,25 de RMS e `--vl` quer 0..1.
   * `0` quando nao ha medida — ai o card cai na animacao (`.speak-glow-auto`).
   */
  const nivelBruto = useVoiceLevel(participant.userId);
  const temNivel = speaking && nivelBruto > 0.012;
  const vl = temNivel ? Math.min(1, Math.max(0.25, nivelBruto * 3.2)) : null;

  const cardRef = useRef<HTMLDivElement>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const [pipOk, setPipOk] = useState(false);
  useEffect(() => {
    setPipOk(
      typeof document !== "undefined" && document.pictureInPictureEnabled,
    );
  }, []);

  async function alternarTelaCheia() {
    const el = cardRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      /* recusado pelo navegador/Electron — sem acao */
    }
  }

  async function alternarPip() {
    const v = videoElRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement)
        await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch {
      /* recusado */
    }
  }

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
      ref={cardRef}
      onContextMenu={openMenu}
      onDoubleClick={faixa ? () => void alternarTelaCheia() : undefined}
      data-od-id={`peer-${participant.userId}`}
      style={vl !== null ? ({ "--vl": vl } as React.CSSProperties) : undefined}
      className={cn(
        "group relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border bg-base-850 p-4 transition-[border-color,background-color,transform] duration-200 [&:fullscreen]:aspect-auto [&:fullscreen]:rounded-none [&:fullscreen]:border-0 [&:fullscreen]:bg-black",
        compact ? "aspect-square w-32 shrink-0 gap-1.5 p-2" : "aspect-[4/3]",
        !isSelf && "cursor-context-menu",
        !compact && "hover:-translate-y-px",
        isTesting
          ? "border-signal-isolate/50 bg-signal-isolate/[0.05] isolate-ring"
          : speaking
            ? cn(
                "border-accent-500/55 bg-accent-500/[0.06] speak-glow",
                !temNivel && "speak-glow-auto",
              )
            : "border-line",
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
        <>
          <CameraVideo
            track={faixa}
            espelhar={isSelf}
            onElement={(el) => (videoElRef.current = el)}
          />
          {/*
            Botoes da camera: tela cheia + PiP. Sempre um pouco visiveis (no
            toque nao ha hover); acendem no hover. Duplo-clique no card tambem
            abre tela cheia. Escondidos nas miniaturas (compact) — la nao cabem.
          */}
          <div
            onDoubleClick={(e) => e.stopPropagation()}
            className={cn(
              "absolute right-2 top-2 z-[2] flex items-center gap-1.5 opacity-70 transition-opacity focus-within:opacity-100 group-hover:opacity-100",
              compact && "hidden",
            )}
          >
            {pipOk ? (
              <CameraAction
                label="Picture-in-picture"
                onClick={() => void alternarPip()}
              >
                <AetherIcon name="pip" size="sm" />
              </CameraAction>
            ) : null}
            <CameraAction
              label="Tela cheia"
              onClick={() => void alternarTelaCheia()}
            >
              <AetherIcon name="maximize" size="sm" />
            </CameraAction>
          </div>
        </>
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
              <AetherIcon
                name="volume-off"
                size="sm"
                className="text-signal-dnd"
              />
            ) : null}
            {muted ? (
              <AetherIcon
                name="mic-off"
                size="sm"
                className="text-signal-dnd"
              />
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
              <span className="text-[11px] font-normal text-ink-500">
                (voce)
              </span>
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

/** Botao pequeno no canto do card de camera (tela cheia / PiP). */
function CameraAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={label}
      aria-label={label}
      className="grid h-8 w-8 place-items-center rounded-md border border-line-strong bg-base-950/70 text-ink-200 backdrop-blur transition-colors hover:bg-base-800 hover:text-ink-100 active:scale-95"
    >
      {children}
    </button>
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
  onElement,
}: {
  track: Track;
  espelhar: boolean;
  /** o <video>, para o card poder pedir picture-in-picture */
  onElement?: (el: HTMLVideoElement | null) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const elemento = ref.current;
    if (!elemento) return;
    track.attach(elemento);
    onElement?.(elemento);
    return () => {
      track.detach(elemento);
      onElement?.(null);
    };
    // `onElement` e closure nova a cada render; incluir reanexaria a faixa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
