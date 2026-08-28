"use client";

import { useState } from "react";
import { MessageSquare, Compass, Plus, HelpCircle, Star } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ServerItem {
  id: string;
  name: string;
  iconUrl?: string | null;
  unreadCount?: number;
  hasMention?: boolean;
}

export interface ServerRailV2Props {
  servers?: ServerItem[];
  activeServerId?: string | null; // null = Home / DMs
  onSelectServer?: (serverId: string | null) => void;
  onAddServer?: () => void;
  onExplore?: () => void;
  onHelp?: () => void;
  className?: string;
}

export function ServerRailV2({
  servers = [
    { id: "s1", name: "Aether Oficial", iconUrl: null, unreadCount: 0 },
    { id: "s2", name: "Gaming Hub", iconUrl: null, unreadCount: 3, hasMention: true },
  ],
  activeServerId = null,
  onSelectServer,
  onAddServer,
  onExplore,
  onHelp,
  className,
}: ServerRailV2Props) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const isHomeActive = activeServerId === null;

  return (
    <nav
      aria-label="Servidores"
      className={cn(
        "flex w-[72px] shrink-0 flex-col items-center gap-2 py-3 bg-base-950 border-r border-base-900 select-none",
        className,
      )}
    >
      {/* Home / Direct Messages Button */}
      <div className="relative flex items-center justify-center w-full group">
        {/* Pill Indicator Esquerdo */}
        <span
          className={cn(
            "absolute left-0 w-1 rounded-r-full bg-white transition-all duration-200",
            isHomeActive
              ? "h-10 opacity-100"
              : hoveredItem === "home"
              ? "h-5 opacity-100"
              : "h-0 opacity-0",
          )}
        />

        {/* Botão de Ícone */}
        <button
          type="button"
          onClick={() => onSelectServer?.(null)}
          onMouseEnter={() => setHoveredItem("home")}
          onMouseLeave={() => setHoveredItem(null)}
          title="Mensagens Diretas"
          aria-label="Mensagens Diretas"
          className={cn(
            "flex h-12 w-12 items-center justify-center transition-all duration-200",
            isHomeActive
              ? "rounded-[16px] bg-accent-500 text-white shadow-[0_0_20px_-6px_var(--color-accent-500)]"
              : "rounded-[24px] bg-base-900 text-ink-200 hover:rounded-[16px] hover:bg-accent-500 hover:text-white",
          )}
        >
          <MessageSquare className="h-6 w-6" />
        </button>
      </div>

      {/* Divisor Sutil */}
      <div className="h-[2px] w-8 rounded-full bg-base-850" />

      {/* Lista Rolável de Servidores */}
      <div className="flex-1 w-full flex flex-col items-center gap-2 overflow-y-auto overflow-x-hidden py-0.5">
        {servers.map((server) => {
          const isActive = activeServerId === server.id;
          const isHovered = hoveredItem === server.id;
          const initials = server.name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();

          return (
            <div
              key={server.id}
              className="relative flex items-center justify-center w-full group"
            >
              {/* Pill Indicator Esquerdo */}
              <span
                className={cn(
                  "absolute left-0 w-1 rounded-r-full bg-white transition-all duration-200",
                  isActive
                    ? "h-10 opacity-100"
                    : isHovered
                    ? "h-5 opacity-100"
                    : "h-0 opacity-0",
                )}
              />

              {/* Botão do Servidor */}
              <button
                type="button"
                onClick={() => onSelectServer?.(server.id)}
                onMouseEnter={() => setHoveredItem(server.id)}
                onMouseLeave={() => setHoveredItem(null)}
                title={server.name}
                aria-label={server.name}
                className={cn(
                  "relative flex h-12 w-12 items-center justify-center font-bold text-sm transition-all duration-200 overflow-hidden",
                  isActive
                    ? "rounded-[16px] bg-accent-500 text-white shadow-[0_0_20px_-6px_var(--color-accent-500)]"
                    : "rounded-[24px] bg-base-900 text-ink-200 hover:rounded-[16px] hover:bg-accent-500 hover:text-white",
                )}
              >
                {server.iconUrl ? (
                  <img
                    src={server.iconUrl}
                    alt={server.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span>{initials}</span>
                )}
              </button>

              {/* Badge de Menção / Não Lida */}
              {server.hasMention ? (
                <span className="absolute -bottom-1 right-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-signal-dnd text-[10px] font-black text-white ring-2 ring-base-950">
                  !
                </span>
              ) : server.unreadCount && server.unreadCount > 0 ? (
                <span className="absolute -bottom-1 right-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-signal-dnd text-[10px] font-bold text-white ring-2 ring-base-950">
                  {server.unreadCount > 9 ? "9+" : server.unreadCount}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Botões de Ação Especiais Inferiores (Print 2) */}
      <div className="flex flex-col items-center gap-2 pt-1 border-t border-base-900 w-full">
        {/* Explorar Comunidades */}
        <div className="relative flex items-center justify-center w-full group">
          <button
            type="button"
            onClick={onExplore}
            title="Explorar comunidades"
            aria-label="Explorar comunidades"
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-[24px] border-2 border-dashed border-base-700 bg-transparent text-signal-online",
              "transition-all duration-200 hover:rounded-[16px] hover:border-signal-online hover:bg-signal-online hover:text-white",
            )}
          >
            <Compass className="h-5 w-5" />
          </button>
        </div>

        {/* Adicionar Servidor */}
        <div className="relative flex items-center justify-center w-full group">
          <button
            type="button"
            onClick={onAddServer}
            title="Adicionar um servidor"
            aria-label="Adicionar um servidor"
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-[24px] border-2 border-dashed border-base-700 bg-transparent text-ink-300",
              "transition-all duration-200 hover:rounded-[16px] hover:border-signal-online hover:bg-signal-online hover:text-white",
            )}
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>

        {/* Ajuda / Suporte */}
        <div className="relative flex items-center justify-center w-full group">
          <button
            type="button"
            onClick={onHelp}
            title="Ajuda e Suporte"
            aria-label="Ajuda e Suporte"
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-[24px] border-2 border-dashed border-base-700 bg-transparent text-ink-400",
              "transition-all duration-200 hover:rounded-[16px] hover:border-base-500 hover:bg-base-800 hover:text-ink-100",
            )}
          >
            <HelpCircle className="h-5 w-5" />
          </button>
        </div>
      </div>
    </nav>
  );
}
