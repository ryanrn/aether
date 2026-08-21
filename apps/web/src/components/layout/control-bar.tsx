"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
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
        <ControlToggle
          active={!muted}
          onClick={toggleMute}
          label={muted ? "Microfone desligado" : "Microfone ligado"}
          danger={muted}
        >
          {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </ControlToggle>

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

        <ControlToggle
          active={false}
          disabled
          label={
            canShare
              ? "Compartilhar tela — disponivel na fase 5"
              : "Voce nao tem permissao para compartilhar tela"
          }
        >
          <MonitorUp className="h-4 w-4" />
        </ControlToggle>

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

        {serverId ? (
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
