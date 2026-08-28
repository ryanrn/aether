"use client";

import { useState } from "react";
import {
  Users,
  FileText,
  Crown,
  Plus,
  Search,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { UserControlBarV2 } from "./user-control-bar-v2";
import { cn } from "@/lib/utils";

export type FriendsTabSection = "amigos" | "notas" | "olimpo" | `dm-${string}`;

export interface DMConversation {
  id: string;
  user: {
    displayName: string;
    username: string;
    avatarUrl?: string | null;
    status: "online" | "idle" | "dnd" | "offline";
    activity?: string;
  };
  unreadCount?: number;
}

export interface FriendsSidebarV2Props {
  activeSection: FriendsTabSection;
  onSelectSection: (section: FriendsTabSection) => void;
  onOpenQuickSwitcher?: () => void;
  onNewDM?: () => void;
  onOpenSettings?: () => void;
  onEditProfile?: () => void;
  dms?: DMConversation[];
  className?: string;
}

export function FriendsSidebarV2({
  activeSection = "amigos",
  onSelectSection,
  onOpenQuickSwitcher,
  onNewDM,
  onOpenSettings,
  onEditProfile,
  dms = [
    {
      id: "dm-1",
      user: {
        displayName: "GuixTorres",
        username: "gui",
        status: "online",
      },
    },
    {
      id: "dm-2",
      user: {
        displayName: "DollyRoxo777",
        username: "dolly",
        status: "dnd",
      },
    },
    {
      id: "dm-3",
      user: {
        displayName: "Rafaela",
        username: "rafa",
        status: "idle",
      },
    },
  ],
  className,
}: FriendsSidebarV2Props) {
  const statusColors = {
    online: "bg-signal-online",
    idle: "bg-signal-idle",
    dnd: "bg-signal-dnd",
    offline: "bg-signal-offline",
  };

  return (
    <div
      className={cn(
        "flex w-60 shrink-0 flex-col bg-base-900 border-r border-base-800 text-ink-200 select-none",
        className,
      )}
    >
      {/* Header: Troca Rápida (CTRL + K) - Print 1 */}
      <div className="flex h-12 items-center px-2.5 border-b border-base-800/80 shadow-sm">
        <button
          type="button"
          onClick={onOpenQuickSwitcher}
          className="flex w-full items-center justify-between rounded-md bg-base-950 px-2.5 py-1.5 text-xs text-ink-400 border border-base-800 hover:border-base-700 hover:text-ink-200 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5" />
            <span className="truncate">Troca rápida</span>
          </div>
          <kbd className="rounded bg-base-800 px-1.5 py-0.5 text-[10px] font-mono text-ink-400 font-semibold">
            CTRL K
          </kbd>
        </button>
      </div>

      {/* Navegação Superior Fixa */}
      <div className="flex flex-col gap-0.5 p-2 border-b border-base-850">
        {/* Amigos */}
        <button
          type="button"
          onClick={() => onSelectSection("amigos")}
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-semibold transition-colors",
            activeSection === "amigos"
              ? "bg-base-800 text-ink-100"
              : "text-ink-300 hover:bg-base-850 hover:text-ink-100",
          )}
        >
          <Users className="h-4 w-4 text-accent-400" />
          <span>Amigos</span>
        </button>

        {/* Notas Pessoais */}
        <button
          type="button"
          onClick={() => onSelectSection("notas")}
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-semibold transition-colors",
            activeSection === "notas"
              ? "bg-base-800 text-ink-100"
              : "text-ink-300 hover:bg-base-850 hover:text-ink-100",
          )}
        >
          <FileText className="h-4 w-4 text-ink-400" />
          <span>Notas pessoais</span>
        </button>

        {/* Olimpo */}
        <button
          type="button"
          onClick={() => onSelectSection("olimpo")}
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-semibold transition-colors",
            activeSection === "olimpo"
              ? "bg-base-800 text-accent-300 font-bold"
              : "text-ink-300 hover:bg-base-850 hover:text-accent-300",
          )}
        >
          <Crown className="h-4 w-4 text-accent-400" />
          <span>Olimpo</span>
        </button>
      </div>

      {/* Seção Mensagens Diretas (DMs) */}
      <div className="flex-1 overflow-y-auto px-2 py-3 flex flex-col gap-1">
        <div className="flex items-center justify-between px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-ink-400">
          <span>Mensagens diretas</span>
          <button
            type="button"
            onClick={onNewDM}
            title="Criar DM"
            aria-label="Criar DM"
            className="rounded p-0.5 text-ink-400 hover:text-ink-100 hover:bg-base-800 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Lista de Conversas */}
        {dms.map((dm) => {
          const isActive = activeSection === dm.id;

          return (
            <button
              key={dm.id}
              type="button"
              onClick={() => onSelectSection(dm.id as FriendsTabSection)}
              className={cn(
                "group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                isActive
                  ? "bg-base-800 text-ink-100 font-medium"
                  : "text-ink-300 hover:bg-base-850 hover:text-ink-100",
              )}
            >
              {/* Avatar com status dot */}
              <div className="relative h-7 w-7 shrink-0 rounded-full bg-base-800 flex items-center justify-center font-bold text-white text-[11px] overflow-hidden">
                {dm.user.avatarUrl ? (
                  <img
                    src={dm.user.avatarUrl}
                    alt={dm.user.displayName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="uppercase">{dm.user.displayName.slice(0, 2)}</span>
                )}
                <span
                  className={cn(
                    "absolute bottom-0 right-0 h-2 w-2 rounded-full border border-base-900",
                    statusColors[dm.user.status],
                  )}
                />
              </div>

              {/* Informações do Amigo */}
              <div className="min-w-0 flex-1 truncate">
                <p className="truncate leading-none text-ink-100 font-medium">
                  {dm.user.displayName}
                </p>
                {dm.user.activity ? (
                  <p className="truncate text-[10px] text-ink-400 mt-0.5">
                    {dm.user.activity}
                  </p>
                ) : null}
              </div>

              {/* Badge de não lida */}
              {dm.unreadCount && dm.unreadCount > 0 ? (
                <span className="shrink-0 rounded-full bg-signal-dnd px-1.5 py-0.2 text-[10px] font-bold text-white">
                  {dm.unreadCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Rodapé com UserControlBar */}
      <UserControlBarV2
        onOpenSettings={onOpenSettings}
        onEditProfile={onEditProfile}
      />
    </div>
  );
}
