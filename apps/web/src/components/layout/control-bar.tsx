"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ChevronUp,
  Headphones,
  HeadphoneOff,
  LogOut,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Settings,
} from "lucide-react";
import type { UserStatus, ViewerContext } from "@aether/shared";
import { logoutAction } from "@/server/actions/auth";
import { Avatar } from "@/components/ui/avatar";
import { viewerCan } from "@/lib/permissions";
import { useSocket } from "@/components/realtime/realtime-provider";
import {
  useConnectionStatus,
  useRealtimeStore,
  useSelfVoice,
} from "@/lib/stores/realtime-store";
import {
  canCaptureScreen,
  PRESET_LIST,
  type SharePresetId,
} from "@/lib/voice/screen-share";
import {
  listMicrophones,
  readPreferredMicrophone,
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
}: {
  user: {
    id: string;
    displayName: string;
    username: string;
    avatarUrl: string | null;
    status: UserStatus;
  };
  viewer: ViewerContext;
}) {
  const params = useParams<{ serverId?: string }>();
  const serverId = params?.serverId;
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
  const [micMenuOpen, setMicMenuOpen] = useState(false);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [micId, setMicId] = useState<string | null>(null);

  // localStorage nao existe no servidor: so lemos depois de montar.
  useEffect(() => setMicId(readPreferredMicrophone()), []);

  async function openMicMenu() {
    const next = !micMenuOpen;
    setMicMenuOpen(next);
    // Enumerar a cada abertura, e nao uma vez: aparelho USB pode ter sido
    // conectado depois que a pagina abriu.
    if (next) setDevices(await listMicrophones());
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

  const muted = selfVoice ? selfVoice.selfMuted : localMuted;
  const deafened = selfVoice ? selfVoice.selfDeafened : localDeafened;

  function toggleMute() {
    const next = !muted;
    setLocalMuted(next);
    socket?.emit("voice:state", { selfMuted: next });
  }

  function toggleDeafen() {
    const next = !deafened;
    setLocalDeafened(next);
    // Ensurdecer implica mutar, como no TeamSpeak.
    if (next) setLocalMuted(true);
    socket?.emit("voice:state", { selfDeafened: next });
  }

  const canShare = viewerCan(viewer, "SCREEN_SHARE");
  /**
   * Mesma condicao da TopBar. Sem isto a engrenagem aparecia para todo mundo e
   * levava a um 404 — o 404 esta correto (nao revelamos que a pagina existe),
   * mas oferecer uma porta que nao abre e problema de interface.
   */
  const canManageServer =
    viewer.isOwner ||
    viewerCan(viewer, "MANAGE_SERVER") ||
    viewerCan(viewer, "MANAGE_ROLES");

  /**
   * Compartilhar exige tres coisas ao mesmo tempo: permissao do cargo, estar
   * numa call (a tela vai para a sala de midia) e um navegador com captura —
   * que so existe em contexto seguro, ou seja, HTTPS ou localhost.
   */
  const shareBlocked = !canShare || !roomControls || !canCaptureScreen();

  async function pickPreset(preset: SharePresetId) {
    setPresetOpen(false);
    await roomControls?.startShare(preset);
  }

  return (
    <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-base-800 bg-base-900 px-3">
      <div className="flex min-w-0 items-center gap-2.5">
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
      </div>

      <div className="mx-1 h-7 w-px bg-base-700" />

      <div className="flex items-center gap-1">
        <div className="relative flex items-center">
          <ControlToggle
            active={!muted}
            onClick={toggleMute}
            label={muted ? "Microfone desligado" : "Microfone ligado"}
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
          label={deafened ? "Audio desativado" : "Audio ativado"}
          danger={deafened}
        >
          {deafened ? (
            <HeadphoneOff className="h-4 w-4" />
          ) : (
            <Headphones className="h-4 w-4" />
          )}
        </ControlToggle>

        <div className="relative">
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

          {presetOpen && !localSharing ? (
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
                  qualidade
                </p>
                {PRESET_LIST.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => void pickPreset(preset.id)}
                    className="flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-base-800"
                  >
                    <span className="text-[13px] text-ink-100">{preset.label}</span>
                    <span className="text-[11px] leading-snug text-ink-500">
                      {preset.description}
                    </span>
                  </button>
                ))}
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

      <div className="ml-auto flex items-center gap-1">
        <span
          title={
            connected
              ? "Conectado ao gateway em tempo real"
              : "Sem conexao com o gateway — presenca e chat ficam parados"
          }
          className={cn(
            "mr-2 hidden font-mono text-[10px] uppercase tracking-[0.12em] sm:inline",
            connected ? "text-signal-online" : "text-ink-500",
          )}
        >
          {status === "online"
            ? "tempo real · ligado"
            : status === "connecting"
              ? "tempo real · conectando"
              : "tempo real · offline"}
        </span>

        {serverId && canManageServer ? (
          <Link
            href={`/app/s/${serverId}/settings`}
            title="Configuracoes do servidor"
            aria-label="Configuracoes do servidor"
            className="grid h-9 w-9 place-items-center rounded-md border border-transparent text-ink-400 transition-colors hover:bg-base-800 hover:text-ink-100"
          >
            <Settings className="h-4 w-4" />
          </Link>
        ) : null}

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
        "grid h-9 w-9 place-items-center rounded-md border transition-colors duration-150",
        danger
          ? "border-signal-dnd/30 bg-signal-dnd/12 text-signal-dnd hover:bg-signal-dnd/20"
          : active
            ? "border-base-600 bg-base-800 text-ink-100 hover:bg-base-750"
            : "border-transparent text-ink-400 hover:bg-base-800 hover:text-ink-100",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
      )}
    >
      {children}
    </button>
  );
}
