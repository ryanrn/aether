"use client";

import { useState } from "react";
import { Mic, MicOff, Headphones, VolumeX, Settings } from "lucide-react";
import { UserProfilePopoverV2 } from "./user-profile-popover-v2";
import { cn } from "@/lib/utils";

export interface UserControlBarV2Props {
  user?: {
    displayName: string;
    username: string;
    avatarUrl?: string | null;
    tag?: string;
    status?: "online" | "idle" | "dnd" | "offline";
    customStatus?: string | null;
    bannerColor?: string;
  };
  onOpenSettings?: () => void;
  onEditProfile?: () => void;
  className?: string;
}

export function UserControlBarV2({
  user = {
    displayName: "ryufpsss",
    username: "ryufpsss",
    tag: "8966",
    status: "online",
    bannerColor: "#e5a919",
  },
  onOpenSettings,
  onEditProfile,
  className,
}: UserControlBarV2Props) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<"online" | "idle" | "dnd" | "offline">(
    user.status || "online",
  );

  const statusColors = {
    online: "bg-signal-online",
    idle: "bg-signal-idle",
    dnd: "bg-signal-dnd",
    offline: "bg-signal-offline",
  };

  return (
    <div className={cn("relative", className)}>
      {/* Popover de Perfil */}
      <UserProfilePopoverV2
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        user={{ ...user, status: currentStatus }}
        onEditProfile={() => {
          setProfileOpen(false);
          onEditProfile?.();
        }}
        onStatusChange={setCurrentStatus}
      />

      {/* Barra de Controle no Rodapé */}
      <div className="flex h-[52px] items-center justify-between gap-1 border-t border-base-800 bg-base-950 px-2 py-1.5 text-ink-200">
        {/* Bloco do Usuário (Avatar + Nome) */}
        <button
          type="button"
          onClick={() => setProfileOpen(!profileOpen)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 -ml-0.5 text-left transition-colors",
            "hover:bg-base-850 active:bg-base-800",
            profileOpen && "bg-base-850",
          )}
          title="Ver perfil e status"
        >
          {/* Avatar com indicador de status */}
          <div className="relative h-8 w-8 shrink-0 rounded-full bg-base-800 flex items-center justify-center font-bold text-white text-xs overflow-hidden">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.displayName}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="uppercase">{user.displayName.slice(0, 2)}</span>
            )}

            <span
              className={cn(
                "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-base-950",
                statusColors[currentStatus],
              )}
            />
          </div>

          {/* Nome e Tag / Subtítulo */}
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-bold text-ink-100">
              {user.displayName}
            </p>
            <p className="truncate text-[11px] text-ink-400">
              {currentStatus === "online" ? "Online" : user.tag ? `#${user.tag}` : "Conectado"}
            </p>
          </div>
        </button>

        {/* Botões de Ação Rápida: Mic, Headphone, Settings */}
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Microfone */}
          <button
            type="button"
            onClick={() => setIsMuted(!isMuted)}
            title={isMuted ? "Desativar mudo" : "Silenciar microfone"}
            aria-label={isMuted ? "Desativar mudo" : "Silenciar microfone"}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md text-ink-300 transition-colors",
              "hover:bg-base-850 hover:text-ink-100 active:bg-base-800",
              isMuted && "text-signal-dnd hover:text-signal-dnd/90",
            )}
          >
            {isMuted ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>

          {/* Fone / Áudio */}
          <button
            type="button"
            onClick={() => setIsDeafened(!isDeafened)}
            title={isDeafened ? "Desativar ensurdecer" : "Ensurdecer"}
            aria-label={isDeafened ? "Desativar ensurdecer" : "Ensurdecer"}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md text-ink-300 transition-colors",
              "hover:bg-base-850 hover:text-ink-100 active:bg-base-800",
              isDeafened && "text-signal-dnd hover:text-signal-dnd/90",
            )}
          >
            {isDeafened ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Headphones className="h-4 w-4" />
            )}
          </button>

          {/* Configurações */}
          <button
            type="button"
            onClick={onOpenSettings}
            title="Configurações do usuário"
            aria-label="Configurações do usuário"
            className="flex h-8 w-8 items-center justify-center rounded-md text-ink-300 transition-colors hover:bg-base-850 hover:text-ink-100 active:bg-base-800"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
