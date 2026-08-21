"use client";

import { useState } from "react";
import type { PublicMember, PublicRole, ViewerContext } from "@aether/shared";
import { viewerCan } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { GeneralTab } from "./general-tab";
import { RolesTab } from "./roles-tab";
import { MembersTab } from "./members-tab";
import { BansTab } from "./bans-tab";
import type { ServerBan } from "@/server/services/moderation";

type Tab = "geral" | "cargos" | "membros" | "banimentos";

export function SettingsTabs({
  serverId,
  serverName,
  roles,
  members,
  ownerId,
  viewer,
  bans,
}: {
  serverId: string;
  serverName: string;
  roles: PublicRole[];
  members: PublicMember[];
  ownerId: string;
  viewer: ViewerContext;
  bans: ServerBan[];
}) {
  const canManageServer = viewerCan(viewer, "MANAGE_SERVER");
  const canManageRoles = viewerCan(viewer, "MANAGE_ROLES");
  const canBanMembers = viewerCan(viewer, "BAN_MEMBERS");

  const tabs: { id: Tab; label: string; enabled: boolean }[] = [
    { id: "geral", label: "Geral", enabled: canManageServer },
    { id: "cargos", label: "Cargos", enabled: canManageRoles },
    { id: "membros", label: "Membros", enabled: canManageRoles },
    { id: "banimentos", label: "Banimentos", enabled: canBanMembers },
  ];

  const first = tabs.find((tab) => tab.enabled)?.id ?? "geral";
  const [active, setActive] = useState<Tab>(first);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-1 border-b border-base-800">
        {tabs
          .filter((tab) => tab.enabled)
          .map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={cn(
                "relative px-3 py-2 text-[13px] transition-colors",
                active === tab.id
                  ? "text-ink-100"
                  : "text-ink-400 hover:text-ink-200",
              )}
            >
              {tab.label}
              {active === tab.id ? (
                <span className="absolute inset-x-2 -bottom-px h-px bg-accent-500" />
              ) : null}
            </button>
          ))}
      </div>

      {active === "geral" && canManageServer ? (
        <GeneralTab serverId={serverId} serverName={serverName} />
      ) : null}

      {active === "cargos" && canManageRoles ? (
        <RolesTab serverId={serverId} roles={roles} viewer={viewer} />
      ) : null}

      {active === "membros" && canManageRoles ? (
        <MembersTab
          serverId={serverId}
          members={members}
          roles={roles}
          ownerId={ownerId}
          viewer={viewer}
        />
      ) : null}

      {active === "banimentos" && canBanMembers ? (
        <BansTab serverId={serverId} bans={bans} />
      ) : null}
    </div>
  );
}
