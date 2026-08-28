"use client";

import { Crown, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ServerMember {
  id: string;
  displayName: string;
  username: string;
  avatarUrl?: string | null;
  status: "online" | "idle" | "dnd" | "offline";
  activity?: string;
  role: string;
  roleColor?: string;
  isOwner?: boolean;
}

export interface MemberGroup {
  name: string;
  color?: string;
  members: ServerMember[];
}

export interface MemberPanelV2Props {
  groups?: MemberGroup[];
  onMemberClick?: (member: ServerMember) => void;
  className?: string;
}

export function MemberPanelV2({
  groups = [
    {
      name: "DONO",
      color: "#3daa7a",
      members: [
        {
          id: "u1",
          displayName: "ryu do aether",
          username: "ryu",
          status: "online",
          role: "DONO",
          roleColor: "#3daa7a",
          isOwner: true,
        },
      ],
    },
    {
      name: "ADMINISTRADOR",
      color: "#38bdf8",
      members: [
        {
          id: "u2",
          displayName: "masoquisxta157",
          username: "maso",
          status: "online",
          role: "ADMINISTRADOR",
          roleColor: "#38bdf8",
        },
        {
          id: "u3",
          displayName: "Gui Torres",
          username: "gui",
          status: "idle",
          role: "ADMINISTRADOR",
          roleColor: "#38bdf8",
        },
        {
          id: "u4",
          displayName: "Ryan",
          username: "ryan",
          status: "online",
          role: "ADMINISTRADOR",
          roleColor: "#38bdf8",
        },
      ],
    },
    {
      name: "MODERADOR",
      color: "#f87171",
      members: [
        {
          id: "u5",
          displayName: "zombie",
          username: "zombie",
          status: "online",
          role: "MODERADOR",
          roleColor: "#f87171",
        },
        {
          id: "u6",
          displayName: "joao",
          username: "joao",
          status: "dnd",
          role: "MODERADOR",
          roleColor: "#f87171",
        },
        {
          id: "u7",
          displayName: "bako",
          username: "bako",
          status: "idle",
          role: "MODERADOR",
          roleColor: "#f87171",
        },
      ],
    },
    {
      name: "MEMBRO",
      color: "#94a3b8",
      members: [
        {
          id: "u8",
          displayName: "Chupa Janja",
          username: "janja",
          status: "online",
          role: "MEMBRO",
          roleColor: "#94a3b8",
        },
        {
          id: "u9",
          displayName: "LucasCR",
          username: "lucas",
          status: "online",
          role: "MEMBRO",
          roleColor: "#94a3b8",
        },
      ],
    },
  ],
  onMemberClick,
  className,
}: MemberPanelV2Props) {
  const statusColors = {
    online: "bg-signal-online",
    idle: "bg-signal-idle",
    dnd: "bg-signal-dnd",
    offline: "bg-signal-offline",
  };

  return (
    <aside
      className={cn(
        "flex w-60 shrink-0 flex-col bg-base-900 border-l border-base-800 p-3 overflow-y-auto select-none",
        className,
      )}
    >
      <div className="flex flex-col gap-4">
        {groups.map((group) => {
          if (group.members.length === 0) return null;

          return (
            <div key={group.name} className="flex flex-col gap-1">
              {/* Header do Grupo / Cargo (Print 5) */}
              <h4 className="px-2 text-[11px] font-bold font-mono uppercase tracking-wider text-ink-400">
                {group.name} — {group.members.length}
              </h4>

              {/* Lista de Membros do Cargo */}
              <div className="flex flex-col gap-0.5">
                {group.members.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => onMemberClick?.(member)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-base-850"
                  >
                    {/* Avatar com status dot */}
                    <div className="relative h-8 w-8 shrink-0 rounded-full bg-base-800 flex items-center justify-center font-bold text-white text-xs overflow-hidden">
                      {member.avatarUrl ? (
                        <img
                          src={member.avatarUrl}
                          alt={member.displayName}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span>{member.displayName.slice(0, 2).toUpperCase()}</span>
                      )}

                      <span
                        className={cn(
                          "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-base-900",
                          statusColors[member.status],
                        )}
                      />
                    </div>

                    {/* Nome + Badge de Dono / Cargo */}
                    <div className="min-w-0 flex-1 truncate">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="truncate text-xs font-semibold"
                          style={{
                            color: member.roleColor || group.color || "var(--color-ink-100)",
                          }}
                        >
                          {member.displayName}
                        </span>

                        {member.isOwner && (
                          <Crown className="h-3 w-3 text-amber-400 shrink-0" />
                        )}
                      </div>

                      {member.activity ? (
                        <p className="truncate text-[10px] text-ink-400">
                          {member.activity}
                        </p>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
