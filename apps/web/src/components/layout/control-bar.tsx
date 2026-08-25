"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Check,
  ChevronUp,
  Headphones,
  HeadphoneOff,
  LogOut,
  Mic,
  MicOff,
  MonitorUp,
  Video,
  VideoOff,
  PhoneOff,
  Settings,
} from "lucide-react";
import type { PublicChannel, UserStatus, ViewerContext } from "@aether/shared";
import { logoutAction } from "@/server/actions/auth";
import { Avatar } from "@/components/ui/avatar";
import { AppSettingsModal } from "@/components/settings/app-settings-modal";
import {
  SelfUserCard,
  type SelfCardAnchor,
} from "@/components/profile/self-user-card";
import { viewerCan } from "@/lib/permissions";
import { useSocket } from "@/components/realtime/realtime-provider";
import {
  useConnectionStatus,
  useRealtimeStore,
  useSelfVoice,
} from "@/lib/stores/realtime-store";
import {
  canCaptureScreen,
  isDesktopApp,
  PRESET_LIST,
  readShareAudioPreference,
  saveShareAudioPreference,
  type SharePresetId,
} from "@/lib/voice/screen-share";
import {
  listMicrophones,
  listCameras,
  readPreferredCamera,
  readPreferredMicrophone,
  savePreferredCamera,
  savePreferredMicrophone,
  type AudioDevice,
} from "@/lib/voice/devices";
import { cn } from "@/lib/utils";

/**
 * Barra de controles inferior.
 *
 * FASE 1: mic/audio/tela guardam apenas a PREFERENCIA local do usuario e ainda
 * nao abrem dispositivo nenhum — nada de audio simulado. A fase 4 conecta esses
 * mesmos botoes ao pipeline WebRTC (getUserMedia / faixa do SFU) e a fase 5
 * conecta o botao de tela ao getDisplayMedia.
 */
export function ControlBar({
  user,
  viewer,
  serverId: currentServerId,
  memberId,
  nickname,
  voiceChannels,
}: {
  user: {
    id: string;
    displayName: string;
    username: string;
    avatarUrl: string | null;
    status: UserStatus;
  };
  viewer: ViewerContext;
  /** servidor aberto agora — o apelido vale so nele */
  serverId: string;
  memberId: string;
  nickname: string | null;
  /** canais de voz — o cartao resolve o NOME do canal em que voce esta */
  voiceChannels: PublicChannel[];
}) {
  const [pending, startTransition] = useTransition();
  const socket = useSocket();
  const status = useConnectionStatus();
  const connected = status === "online";
  const presence = useRealtimeStore((state) => state.presence);
  const selfVoice = useSelfVoice();

  /**
   * Fora de uma call, mic/audio sao preferencia local. Dentro de uma call,
   * quem manda e o gateway — ele e a fonte de verdade que os outros veem, e
   * discordar dele deixaria seu icone diferente do que aparece para todos.
   */
  const [localMuted, setLocalMuted] = useState(false);
  const [localDeafened, setLocalDeafened] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [selfCard, setSelfCard] = useState<SelfCardAnchor | null>(null);
  const [shareAudio, setShareAudio] = useState(true);
  /** No desktop o seletor do Electron tem a chave de som; duas confundiriam. */
  const [noDesktop, setNoDesktop] = useState(false);
  const [micMenuOpen, setMicMenuOpen] = useState(false);
  const [camMenuOpen, setCamMenuOpen] = useState(false);
  const [cameras, setCameras] = useState<AudioDevice[]>([]);
  const [camId, setCamId] = useState<string | null>(null);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [micId, setMicId] = useState<string | null>(null);

  // localStorage nao existe no servidor: so lemos depois de montar.
  useEffect(() => setMicId(readPreferredMicrophone()), []);
  useEffect(() => setCamId(readPreferredCamera()), []);
  useEffect(() => setShareAudio(readShareAudioPreference()), []);
  // Depois de montar: `window.aetherDesktop` nao existe no servidor.
  useEffect(() => setNoDesktop(isDesktopApp()), []);

  async function openMicMenu() {
    const next = !micMenuOpen;
    setMicMenuOpen(next);
    // Enumerar a cada abertura, e nao uma vez: aparelho USB pode ter sido
    // conectado depois que a pagina abriu.
    if (next) setDevices(await listMicrophones());
  }

  async function abrirMenuDeCamera() {
    const proximo = !camMenuOpen;
    setCamMenuOpen(proximo);
    // Enumerar a cada abertura: camera USB pode ter sido ligada depois.
    if (proximo) setCameras(await listCameras());
  }

  async function escolherCamera(deviceId: string) {
    setCamMenuOpen(false);
    setCamId(deviceId);
    savePreferredCamera(deviceId);
    /**
     * Com a camera JA ligada, trocar exige republicar com o aparelho novo —
     * o LiveKit nao troca a fonte de uma faixa no ar. Desligada, a escolha
     * fica guardada e vale quando ligar.
     */
    if (cameraLigada) await roomControls?.setCameraEnabled(true, deviceId);
  }

  async function pickMicrophone(deviceId: string) {
    setMicMenuOpen(false);
    setMicId(deviceId);
    savePreferredMicrophone(deviceId);
    // Sem call ativa a escolha fica guardada e vale na proxima conexao.
    await roomControls?.setMicrophone(deviceId);
  }

  const roomControls = useRealtimeStore((state) => state.roomControls);
  const localSharing = useRealtimeStore((state) => state.localSharing);
  const sharePreset = useRealtimeStore((state) => state.sharePreset);

  /**
   * Moderacao ganha do proprio controle: quem foi silenciado pelo servidor nao
   * se desfaz sozinho. O SFU ja impede publicar, mas deixar o botao ligavel
   * daria a impressao de que voltou a falar.
   */
  const serverMuted = selfVoice?.serverMuted ?? false;
  const serverDeafened = selfVoice?.serverDeafened ?? false;

  const muted = serverMuted || (selfVoice ? selfVoice.selfMuted : localMuted);
  const deafened =
    serverDeafened || (selfVoice ? selfVoice.selfDeafened : localDeafened);

  function toggleMute() {
    if (serverMuted) return;
    const next = !muted;
    setLocalMuted(next);
    socket?.emit("voice:state", { selfMuted: next });
  }

  function toggleDeafen() {
    if (serverDeafened) return;
    const next = !deafened;
    setLocalDeafened(next);
    // Ensurdecer implica mutar, como no TeamSpeak.
    if (next) setLocalMuted(true);
    socket?.emit("voice:state", { selfDeafened: next });
  }

  const canShare = viewerCan(viewer, "SCREEN_SHARE");
  /**
   * Compartilhar exige tres coisas ao mesmo tempo: permissao do cargo, estar
   * numa call (a tela vai para a sala de midia) e um navegador com captura —
   * que so existe em contexto seguro, ou seja, HTTPS ou localhost.
   */
  const shareBlocked = !canShare || !roomControls || !canCaptureScreen();

  /**
   * A camera exige o cargo e estar numa call, pelas mesmas razoes da tela.
   *
   * A checagem AQUI e conveniencia: quem decide de verdade e o token do SFU,
   * que so lista a fonte CAMERA para quem tem a permissao. Esconder o botao
   * evita oferecer o que seria recusado; nao e o que protege.
   */
  const podeCamera = viewerCan(viewer, "CAMERA");
  const cameraBloqueada = !podeCamera || !roomControls;
  const cameraLigada = useRealtimeStore((estado) => estado.localCameraTrack) !== null;

  async function alternarCamera() {
    if (!roomControls) return;
    const desejado = !cameraLigada;
    const deu = await roomControls.setCameraEnabled(
      desejado,
      desejado ? (camId ?? undefined) : undefined,
    );
    if (!deu) return;
    /**
     * O indicador so e anunciado DEPOIS de a faixa mudar de verdade. Anunciar
     * antes acenderia a camera na tela dos outros enquanto o dispositivo ainda
     * podia recusar.
     */
    socket?.emit("voice:camera", desejado);
  }

  /**
   * Transmitindo, troca a qualidade da faixa que ja esta no ar; parado,
   * comeca uma transmissao nova. O mesmo menu serve para os dois porque a
   * escolha e a mesma — o que muda e so haver ou nao faixa para ajustar.
   */
  async function pickPreset(preset: SharePresetId) {
    setPresetOpen(false);
    if (localSharing) {
      await roomControls?.setSharePreset(preset);
      return;
    }
    const started = await roomControls?.startShare(preset, shareAudio);
    /**
     * O `startScreenShare` desliga a preferencia sozinho quando o sistema
     * recusa abrir o som. Relemos para a chave na tela refletir isso — senao
     * ela continuaria ligada e a proxima tentativa falharia igual.
     */
    if (!started) setShareAudio(readShareAudioPreference());
  }

  function toggleShareAudio() {
    const next = !shareAudio;
    setShareAudio(next);
    saveShareAudioPreference(next);
  }

  return (
    <footer
      /**
       * HUD, nao rodape. Ancorada no PALCO (o <main> e `relative`), flutuando
       * a 20px do fundo e centrada — nao presa a borda da janela nem ocupando
       * a largura toda. `z-30` a mantem sobre o conteudo do canal; `w-max`
       * impede que ela estique.
       */
      className="absolute bottom-5 left-1/2 z-30 flex w-max -translate-x-1/2 items-center gap-2 rounded-lg border border-base-800 bg-base-800/95 px-3 py-2 shadow-[var(--shadow-pop)] backdrop-blur-sm"
    >
      {/*
        O nome abre o CARTAO, nao as configuracoes.
        Antes ia direto para uma tela inteira — e o que se quer ao clicar no
        proprio nome, na maioria das vezes, e olhar a call ou trocar o status.
        As configuracoes seguem a um clique, de dentro do cartao.
      */}
      <button
        type="button"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setSelfCard((atual) =>
            atual ? null : { x: rect.left, y: rect.top - 340 },
          );
        }}
        title="Voce"
        className="flex min-w-0 items-center gap-2 rounded-md py-0.5 pr-1 text-left transition-opacity hover:opacity-80"
      >
        <Avatar
          userId={user.id}
          name={user.displayName}
          src={user.avatarUrl}
          status={presence[user.id] ?? "OFFLINE"}
          size="sm"
        />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-medium text-ink-100">
            {user.displayName}
          </p>
          <p className="truncate font-mono text-[11px] text-ink-500">
            @{user.username}
          </p>
        </div>
      </button>

      {selfCard ? (
        <SelfUserCard
          user={user}
          voiceChannels={voiceChannels}
          anchor={selfCard}
          onClose={() => setSelfCard(null)}
          onOpenSettings={() => setProfileOpen(true)}
        />
      ) : null}

      <AppSettingsModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        user={user}
        server={{ id: currentServerId, memberId, nickname }}
      />

      <div className="mx-0.5 h-6 w-px bg-base-700" />

      <div className="flex items-center gap-1">
        <div className="relative flex items-center">
          <ControlToggle
            active={!muted}
            onClick={toggleMute}
            disabled={serverMuted}
            label={
              serverMuted
                ? "Silenciado pela moderacao do servidor"
                : muted
                  ? "Microfone desligado"
                  : "Microfone ligado"
            }
            danger={muted}
          >
            {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </ControlToggle>

          <button
            type="button"
            onClick={() => void openMicMenu()}
            title="Escolher microfone"
            aria-label="Escolher microfone"
            className="grid h-9 w-4 place-items-center rounded-r-md text-ink-500 transition-colors hover:text-ink-100"
          >
            <ChevronUp className="h-3 w-3" />
          </button>

          {micMenuOpen ? (
            <>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setMicMenuOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div className="absolute bottom-11 left-0 z-50 w-72 animate-rise rounded-lg border border-base-700 bg-base-900 p-1 shadow-xl">
                <p className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
                  microfone
                </p>
                {devices.length === 0 ? (
                  <p className="px-2 pb-2 text-[12px] leading-snug text-ink-500">
                    Nenhum microfone encontrado. Conecte um e abra de novo.
                  </p>
                ) : (
                  devices.map((device) => (
                    <button
                      key={device.deviceId}
                      type="button"
                      onClick={() => void pickMicrophone(device.deviceId)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] transition-colors hover:bg-base-800",
                        device.deviceId === micId
                          ? "text-accent-300"
                          : "text-ink-200",
                      )}
                    >
                      <Mic className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{device.label}</span>
                    </button>
                  ))
                )}
                <p className="border-t border-base-800 px-2 py-1.5 text-[11px] leading-snug text-ink-600">
                  Os nomes so aparecem depois de voce permitir o microfone uma
                  vez.
                </p>
              </div>
            </>
          ) : null}
        </div>

        <ControlToggle
          active={!deafened}
          onClick={toggleDeafen}
          disabled={serverDeafened}
          label={
            serverDeafened
              ? "Audio desativado pela moderacao do servidor"
              : deafened
                ? "Audio desativado"
                : "Audio ativado"
          }
          danger={deafened}
        >
          {deafened ? (
            <HeadphoneOff className="h-4 w-4" />
          ) : (
            <Headphones className="h-4 w-4" />
          )}
        </ControlToggle>

        <div className="relative flex items-center">
          <ControlToggle
          active={cameraLigada}
          danger={cameraLigada}
          disabled={cameraBloqueada}
          onClick={() => void alternarCamera()}
          label={
            cameraLigada
              ? "Desligar a camera"
              : !podeCamera
                ? "Seu cargo nao permite ligar a camera"
                : !roomControls
                  ? "Entre em um canal de voz para ligar a camera"
                  : "Ligar a camera"
          }
        >
          {cameraLigada ? (
            <VideoOff className="h-4 w-4" />
          ) : (
            <Video className="h-4 w-4" />
          )}
          </ControlToggle>

          <button
            type="button"
            onClick={() => void abrirMenuDeCamera()}
            disabled={cameraBloqueada}
            title="Escolher camera"
            aria-label="Escolher camera"
            className="grid h-9 w-4 place-items-center rounded-r-md text-ink-500 transition-colors hover:text-ink-100 disabled:opacity-40"
          >
            <ChevronUp className="h-3 w-3" />
          </button>

          {camMenuOpen ? (
            <>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setCamMenuOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div className="absolute bottom-11 left-0 z-50 w-72 animate-rise rounded-lg border border-base-700 bg-base-900 p-1 shadow-xl">
                <p className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
                  camera
                </p>
                {cameras.length === 0 ? (
                  <p className="px-2 pb-2 text-[12px] leading-snug text-ink-500">
                    Nenhuma camera encontrada. Conecte uma e abra de novo.
                  </p>
                ) : (
                  cameras.map((aparelho) => (
                    <button
                      key={aparelho.deviceId}
                      type="button"
                      onClick={() => void escolherCamera(aparelho.deviceId)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] transition-colors hover:bg-base-800",
                        aparelho.deviceId === camId
                          ? "text-accent-300"
                          : "text-ink-200",
                      )}
                    >
                      <Video className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{aparelho.label}</span>
                    </button>
                  ))
                )}
                <p className="border-t border-base-800 px-2 py-1.5 text-[11px] leading-snug text-ink-600">
                  Os nomes so aparecem depois de voce permitir a camera uma vez.
                </p>
              </div>
            </>
          ) : null}
        </div>

        <div className="relative flex items-center">
          <ControlToggle
            active={localSharing}
            danger={localSharing}
            disabled={shareBlocked}
            onClick={() => {
              if (localSharing) {
                void roomControls?.stopShare();
                return;
              }
              setPresetOpen((open) => !open);
            }}
            label={
              localSharing
                ? "Parar de compartilhar"
                : !canShare
                  ? "Seu cargo nao permite compartilhar tela"
                  : !roomControls
                    ? "Entre em um canal de voz para compartilhar"
                    : !canCaptureScreen()
                      ? "Este navegador nao permite captura de tela"
                      : "Compartilhar tela"
            }
          >
            <MonitorUp className="h-4 w-4" />
          </ControlToggle>

          {/*
            Setinha para a qualidade, no mesmo vocabulario que o microfone ja
            usa para trocar de aparelho. Existe SOBRETUDO enquanto se
            transmite: sem ela, mudar de perfil obrigava a parar e comecar de
            novo, e o Chrome reabriria o seletor de tela no meio da conversa.
          */}
          {localSharing ? (
            <button
              type="button"
              onClick={() => setPresetOpen((open) => !open)}
              title="Trocar a qualidade sem parar a transmissao"
              aria-label="Trocar a qualidade da transmissao"
              className="grid h-9 w-4 place-items-center rounded-r-md text-ink-500 transition-colors hover:text-ink-100"
            >
              <ChevronUp className="h-3 w-3" />
            </button>
          ) : null}

          {presetOpen ? (
            <>
              {/* clique fora fecha, sem prender o foco da pagina */}
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setPresetOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div className="absolute bottom-11 left-0 z-50 w-64 animate-rise rounded-lg border border-base-700 bg-base-900 p-1 shadow-xl">
                <p className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
                  {localSharing ? "trocar qualidade" : "qualidade"}
                </p>

                {/*
                  A escolha do som vem ANTES do seletor nativo abrir, de
                  proposito. `getDisplayMedia` e tudo-ou-nada com audio: se o
                  sistema recusar abrir o som, a captura inteira falha. Antes
                  descobriamos isso tentando e refazendo — o que reabria o
                  seletor. Melhor decidir aqui.

                  So aparece antes de comecar: com a transmissao no ar, mudar
                  isso exigiria recapturar, que e justamente o que evitamos.
                */}
                {!localSharing && !noDesktop ? (
                  <label className="mb-1 flex cursor-pointer items-start gap-2 border-b border-base-800 px-2 pb-2 text-[12px] text-ink-200">
                    <input
                      type="checkbox"
                      checked={shareAudio}
                      onChange={toggleShareAudio}
                      className="mt-0.5 accent-accent-500"
                    />
                    <span className="leading-snug">
                      Levar o som do sistema
                      <span className="mt-0.5 block text-[11px] text-ink-500">
                        Aba e tela inteira oferecem som; janela avulsa nao.
                      </span>
                    </span>
                  </label>
                ) : null}
                {PRESET_LIST.map((preset) => {
                  const active = localSharing && preset.id === sharePreset;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => void pickPreset(preset.id)}
                      className={cn(
                        "flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-base-800",
                        active && "bg-base-800",
                      )}
                    >
                      <span
                        className={cn(
                          "flex items-center gap-1.5 text-[13px]",
                          active ? "text-accent-300" : "text-ink-100",
                        )}
                      >
                        {preset.label}
                        {active ? (
                          <Check className="h-3 w-3 shrink-0" />
                        ) : null}
                      </span>
                      <span className="text-[11px] leading-snug text-ink-500">
                        {preset.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>

        {selfVoice ? (
          <ControlToggle
            active={false}
            danger
            onClick={() => socket?.emit("voice:leave")}
            label="Desconectar da voz"
          >
            <PhoneOff className="h-4 w-4" />
          </ControlToggle>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        {/*
          O estado do tempo real virou um PONTO. Escrito por extenso
          ("tempo real · ligado") ele sozinho era mais largo que todos os
          botoes somados, e numa HUD flutuante largura e o recurso escasso.
          A informacao continua inteira no title.
        */}
        <span
          title={
            connected
              ? "Conectado ao gateway em tempo real"
              : "Sem conexao com o gateway — presenca e chat ficam parados"
          }
          className={cn(
            "mr-1 h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
            status === "online"
              ? "bg-signal-online"
              : status === "connecting"
                ? "bg-signal-idle"
                : "bg-ink-500",
          )}
        />

        {/*
          Esta engrenagem e do APP, nao do servidor. A do servidor mora no
          cabecalho da coluna de canais — antes as duas faziam a MESMA coisa,
          e uma delas era caminho repetido sem nada a mais.
        */}
        <ControlToggle
          active={false}
          label="Configuracoes"
          onClick={() => setProfileOpen(true)}
        >
          <Settings className="h-4 w-4" />
        </ControlToggle>

        <ControlToggle
          active={false}
          label="Sair da conta"
          onClick={() => startTransition(() => logoutAction())}
          disabled={pending}
        >
          <LogOut className="h-4 w-4" />
        </ControlToggle>
      </div>
    </footer>
  );
}

function ControlToggle({
  children,
  active,
  danger,
  disabled,
  label,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-full transition-colors duration-150",
        danger
          ? "bg-signal-dnd/12 text-signal-dnd hover:bg-signal-dnd/20"
          : active
            ? "bg-accent-500 text-white hover:bg-accent-400"
            : "bg-white/[0.04] text-ink-300 hover:bg-white/[0.08] hover:text-ink-100",
        disabled && "cursor-not-allowed opacity-40 hover:bg-white/[0.04]",
      )}
    >
      {children}
    </button>
  );
}
