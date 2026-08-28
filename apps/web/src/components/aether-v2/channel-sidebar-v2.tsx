"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Hash,
  Volume2,
  Lock,
  Plus,
  Settings,
  UserPlus,
  Users,
  FolderPlus,
  MessageSquare,
} from "lucide-react";
import { UserControlBarV2 } from "./user-control-bar-v2";
import { cn } from "@/lib/utils";

export interface ChannelItem {
  id: string;
  name: string;
  type: "text" | "voice";
  isPrivate?: boolean;
  unreadCount?: number;
  participants?: {
    id: string;
    displayName: string;
    avatarUrl?: string | null;
    isMuted?: boolean;
    isDeafened?: boolean;
  }[];
}

export interface ChannelCategory {
  id: string;
  name: string;
  channels: ChannelItem[];
}

export interface ChannelSidebarV2Props {
  serverName?: string;
  categories?: ChannelCategory[];
  activeChannelId?: string;
  onSelectChannel?: (channelId: string) => void;
  onOpenServerSettings?: () => void;
  onInvite?: () => void;
  onCreateChannel?: (categoryId?: string) => void;
  onCreateCategory?: () => void;
  onOpenSettings?: () => void;
  onEditProfile?: () => void;
  className?: string;
}

export function ChannelSidebarV2({
  serverName = "Aether Oficial",
  categories = [
    {
      id: "cat-1",
      name: "Geral",
      channels: [
        { id: "c1", name: "chat-geral", type: "text" },
        { id: "c2", name: "teste", type: "text" },
      ],
    },
    {
      id: "cat-2",
      name: "Gaming",
      channels: [
        { id: "c3", name: "Sala 1", type: "voice" },
        { id: "c4", name: "Sala 2", type: "voice" },
      ],
    },
    {
      id: "cat-3",
      name: "Privado",
      channels: [
        { id: "c5", name: "staff-only", type: "text", isPrivate: true },
      ],
    },
  ],
  activeChannelId = "c1",
  onSelectChannel,
  onOpenServerSettings,
  onInvite,
  onCreateChannel,
  onCreateCategory,
  onOpenSettings,
  onEditProfile,
  className,
}: ChannelSidebarV2Props) {
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [serverMenuOpen, setServerMenuOpen] = useState(false);

  const toggleCategory = (catId: string) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [catId]: !prev[catId],
    }));
  };

  return (
    <div
      className={cn(
        "flex w-60 shrink-0 flex-col bg-base-900 border-r border-base-800 text-ink-200 select-none",
        className,
      )}
    >
      {/* Header do Servidor com Dropdown (Print 2 & 5) */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setServerMenuOpen(!serverMenuOpen)}
          className={cn(
            "flex h-12 w-full items-center justify-between px-4 border-b border-base-850 font-bold text-ink-100 text-sm",
            "hover:bg-base-850 transition-colors shadow-sm",
            serverMenuOpen && "bg-base-850",
          )}
        >
          <span className="truncate">{serverName}</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-ink-300 transition-transform duration-200",
              serverMenuOpen && "rotate-180",
            )}
          />
        </button>

        {/* Menu Dropdown do Servidor */}
        {serverMenuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setServerMenuOpen(false)} />
            <div className="absolute left-2 right-2 top-14 z-40 rounded-lg border border-base-750 bg-base-950 p-1.5 shadow-pop animate-in-fast flex flex-col gap-0.5 text-xs text-ink-200">
              <button
                type="button"
                onClick={() => {
                  setServerMenuOpen(false);
                  onInvite?.();
                }}
                className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-accent-400 font-semibold hover:bg-accent-500 hover:text-white transition-colors"
              >
                <span>Convidar pessoas</span>
                <UserPlus className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setServerMenuOpen(false);
                  onOpenServerSettings?.();
                }}
                className="flex w-full items-center justify-between rounded px-2.5 py-1.5 hover:bg-base-850 hover:text-ink-100 transition-colors"
              >
                <span>Configurações do servidor</span>
                <Settings className="h-3.5 w-3.5" />
              </button>

              <div className="my-1 h-px bg-base-850" />

              <button
                type="button"
                onClick={() => {
                  setServerMenuOpen(false);
                  onCreateChannel?.();
                }}
                className="flex w-full items-center justify-between rounded px-2.5 py-1.5 hover:bg-base-850 hover:text-ink-100 transition-colors"
              >
                <span>Criar canal</span>
                <Plus className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setServerMenuOpen(false);
                  onCreateCategory?.();
                }}
                className="flex w-full items-center justify-between rounded px-2.5 py-1.5 hover:bg-base-850 hover:text-ink-100 transition-colors"
              >
                <span>Criar categoria</span>
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Árvore de Canais e Categorias Rolável */}
      <div className="flex-1 overflow-y-auto px-2 py-3 flex flex-col gap-4">
        {/* Atalho Rápido "Membros" (Print 2) */}
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-ink-300 hover:bg-base-850 hover:text-ink-100 transition-colors"
          >
            <Users className="h-4 w-4 text-ink-400" />
            <span>Membros</span>
          </button>
        </div>

        {/* Categorias e Canais */}
        {categories.map((category) => {
          const isCollapsed = collapsedCategories[category.id];

          return (
            <div key={category.id} className="flex flex-col gap-0.5">
              {/* Header da Categoria com recolhimento e + */}
              <div className="group flex items-center justify-between px-1.5 py-1 text-[11px] font-bold uppercase tracking-wider text-ink-400 hover:text-ink-200">
                <button
                  type="button"
                  onClick={() => toggleCategory(category.id)}
                  className="flex items-center gap-1 flex-1 text-left"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3 text-ink-500" />
                  ) : (
                    <ChevronDown className="h-3 w-3 text-ink-500" />
                  )}
                  <span className="truncate">{category.name}</span>
                </button>

                <button
                  type="button"
                  onClick={() => onCreateChannel?.(category.id)}
                  title="Criar canal nesta categoria"
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-ink-400 hover:text-ink-100 hover:bg-base-800 transition-all"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Lista de Canais */}
              {!isCollapsed && (
                <div className="flex flex-col gap-0.5 mt-0.5">
                  {category.channels.map((channel) => {
                    const isActive = activeChannelId === channel.id;

                    return (
                      <div key={channel.id} className="flex flex-col">
                        <button
                          type="button"
                          onClick={() => onSelectChannel?.(channel.id)}
                          className={cn(
                            "group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                            isActive
                              ? "bg-base-800 text-ink-100 font-semibold shadow-sm"
                              : "text-ink-300 hover:bg-base-850 hover:text-ink-100",
                          )}
                        >
                          <div className="flex items-center gap-2 min-w-0 truncate">
                            {channel.isPrivate ? (
                              <Lock className="h-4 w-4 text-ink-500 shrink-0" />
                            ) : channel.type === "voice" ? (
                              <Volume2 className="h-4 w-4 text-ink-400 shrink-0" />
                            ) : (
                              <Hash className="h-4 w-4 text-ink-400 shrink-0" />
                            )}
                            <span className="truncate">{channel.name}</span>
                          </div>

                          {/* Ações Inline no Hover (Print 2) */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span
                              title="Convidar"
                              onClick={(e) => {
                                e.stopPropagation();
                                onInvite?.();
                              }}
                              className="p-0.5 rounded text-ink-400 hover:text-ink-100 hover:bg-base-800"
                            >
                              <UserPlus className="h-3 w-3" />
                            </span>
                          </div>
                        </button>

                        {/* Participantes Ativos no Canal de Voz */}
                        {channel.type === "voice" &&
                          channel.participants &&
                          channel.participants.length > 0 && (
                            <div className="ml-6 flex flex-col gap-1 py-1">
                              {channel.participants.map((p) => (
                                <div
                                  key={p.id}
                                  className="flex items-center gap-2 rounded px-1.5 py-0.5 text-xs text-ink-300"
                                >
                                  <div className="h-5 w-5 rounded-full bg-base-800 flex items-center justify-center text-[10px] font-bold text-white overflow-hidden">
                                    {p.displayName.slice(0, 2).toUpperCase()}
                                  </div>
                                  <span className="truncate flex-1">{p.displayName}</span>
                                </div>
                              ))}
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Botões de Ação na Base da Lista (Print 5) */}
        <div className="flex flex-col gap-1 pt-2 border-t border-base-850/60 text-ink-400 text-xs">
          <button
            type="button"
            onClick={() => onCreateChannel?.()}
            className="flex items-center gap-2 rounded px-2 py-1 hover:bg-base-850 hover:text-ink-200 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Novo canal</span>
          </button>
          <button
            type="button"
            onClick={onCreateCategory}
            className="flex items-center gap-2 rounded px-2 py-1 hover:bg-base-850 hover:text-ink-200 transition-colors"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span>Nova categoria</span>
          </button>
        </div>
      </div>

      {/* Rodapé com UserControlBar */}
      <UserControlBarV2
        onOpenSettings={onOpenSettings}
        onEditProfile={onEditProfile}
      />
    </div>
  );
}
