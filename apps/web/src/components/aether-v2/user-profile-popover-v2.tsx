"use client";

import { useState } from "react";
import {
  User,
  Smile,
  Users,
  Copy,
  Check,
  Edit3,
  LogOut,
  ChevronRight,
  Shield,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface UserProfilePopoverV2Props {
  open: boolean;
  onClose: () => void;
  user: {
    displayName: string;
    username: string;
    avatarUrl?: string | null;
    tag?: string;
    status?: "online" | "idle" | "dnd" | "offline";
    customStatus?: string | null;
    bannerColor?: string;
  };
  onEditProfile?: () => void;
  onStatusChange?: (status: "online" | "idle" | "dnd" | "offline") => void;
}

export function UserProfilePopoverV2({
  open,
  onClose,
  user,
  onEditProfile,
  onStatusChange,
}: UserProfilePopoverV2Props) {
  const [copied, setCopied] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);

  if (!open) return null;

  const userTag = user.tag || "8966";
  const bannerColor = user.bannerColor || "#e5a919"; // Amarelo/Dourado característico do print 3

  const statusColors = {
    online: "bg-signal-online",
    idle: "bg-signal-idle",
    dnd: "bg-signal-dnd",
    offline: "bg-signal-offline",
  };

  const statusLabels = {
    online: "Online",
    idle: "Ausente",
    dnd: "Não perturbar",
    offline: "Invisível",
  };

  const currentStatus = user.status || "online";

  const handleCopyId = () => {
    navigator.clipboard.writeText(`${user.username}#${userTag}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      {/* Backdrop transparente para fechar ao clicar fora */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Popover Card posicionado sobre o painel do usuário */}
      <div
        className={cn(
          "absolute bottom-14 left-2 z-50 w-72 overflow-hidden rounded-xl",
          "border border-base-750 bg-base-900 shadow-pop animate-in-fast text-ink-100",
        )}
      >
        {/* Banner Superior Colorido */}
        <div
          className="h-20 w-full relative"
          style={{ backgroundColor: bannerColor }}
        >
          <div className="absolute top-2 right-2 flex gap-1">
            <button
              type="button"
              onClick={onEditProfile}
              className="p-1 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
              title="Editar Perfil"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Informações do Usuário e Avatar Sobreposto */}
        <div className="relative px-4 pb-4 pt-0">
          {/* Avatar com borda espessa integrada ao banner */}
          <div className="relative -mt-10 mb-2.5 inline-block">
            <div className="relative h-18 w-18 rounded-full border-[5px] border-base-900 bg-base-800 overflow-hidden flex items-center justify-center text-white text-xl font-bold">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="uppercase">{user.displayName.slice(0, 2)}</span>
              )}
            </div>

            {/* Status Indicator Dot */}
            <span
              className={cn(
                "absolute bottom-1 right-1 h-4 w-4 rounded-full border-[3px] border-base-900",
                statusColors[currentStatus],
              )}
            />
          </div>

          {/* Nome e Tag */}
          <div className="flex flex-col">
            <h3 className="text-base font-bold text-ink-100 leading-tight">
              {user.displayName}
            </h3>
            <span className="text-xs text-ink-400 font-mono">
              {user.username}#{userTag}
            </span>
          </div>

          {/* Definir Recado Personalizado */}
          <button
            type="button"
            className="mt-3 flex w-full items-center gap-2 rounded-md py-1.5 text-xs text-ink-400 hover:text-ink-200 transition-colors"
          >
            <Smile className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {user.customStatus || "Definir um recado personalizado"}
            </span>
          </button>

          {/* Divisor */}
          <div className="my-2.5 h-px bg-base-800" />

          {/* Menu de Ações em Card Elevado */}
          <div className="flex flex-col gap-0.5 rounded-lg bg-base-850 p-1 border border-base-750/60 text-xs">
            {/* Seletor de Status */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setStatusMenuOpen(!statusMenuOpen)}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-2 hover:bg-base-750 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "h-2.5 w-2.5 rounded-full shrink-0",
                      statusColors[currentStatus],
                    )}
                  />
                  <span className="font-medium text-ink-200">
                    {statusLabels[currentStatus]}
                  </span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-ink-400" />
              </button>

              {/* Submenu de Status */}
              {statusMenuOpen && (
                <div className="mt-1 flex flex-col gap-0.5 rounded-md bg-base-800 p-1 border border-base-700">
                  {(["online", "idle", "dnd", "offline"] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => {
                        onStatusChange?.(st);
                        setStatusMenuOpen(false);
                      }}
                      className={cn(
                        "flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
                        currentStatus === st
                          ? "bg-base-700 text-ink-100 font-semibold"
                          : "text-ink-300 hover:bg-base-750 hover:text-ink-100",
                      )}
                    >
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full",
                          statusColors[st],
                        )}
                      />
                      <span>{statusLabels[st]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Trocar de Conta */}
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md px-2.5 py-2 hover:bg-base-750 transition-colors text-ink-200"
            >
              <div className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-ink-400 shrink-0" />
                <span className="font-medium">Trocar de conta</span>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-ink-400" />
            </button>

            {/* Copiar ID de usuário */}
            <button
              type="button"
              onClick={handleCopyId}
              className="flex w-full items-center justify-between rounded-md px-2.5 py-2 hover:bg-base-750 transition-colors text-ink-200"
            >
              <div className="flex items-center gap-2">
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-signal-online shrink-0" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-ink-400 shrink-0" />
                )}
                <span className="font-medium">
                  {copied ? "ID Copiado!" : "Copiar ID de usuário"}
                </span>
              </div>
            </button>
          </div>

          {/* Botão Primário: Editar Perfil */}
          <div className="mt-3">
            <Button
              variant="primary"
              size="sm"
              onClick={onEditProfile}
              className="w-full font-bold gap-1.5 shadow-md"
            >
              <Edit3 className="h-3.5 w-3.5" />
              Editar perfil
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
