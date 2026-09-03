"use client";

import { useState } from "react";
import type { PublicMember, PublicRole, ViewerContext } from "@aether/shared";
import { viewerCan } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { GeneralTab } from "./general-tab";
import { RolesTab } from "./roles-tab";
import { MembersTab } from "./members-tab";
import { BansTab } from "./bans-tab";
import { AuditTab } from "./audit-tab";
import type { ServerBan } from "@/server/services/moderation";
import type { AuditEntry } from "@/server/services/audit-log";

type Tab = "geral" | "cargos" | "membros" | "banimentos" | "registro";

export function SettingsTabs({
  serverId,
  serverName,
  serverIconUrl,
  roles,
  members,
  ownerId,
  viewer,
  bans,
  audit,
}: {
  serverId: string;
  serverName: string;
  serverIconUrl: string | null;
  roles: PublicRole[];
  members: PublicMember[];
  ownerId: string;
  viewer: ViewerContext;
  bans: ServerBan[];
  audit: { entries: AuditEntry[]; hasMore: boolean };
}) {
  const canManageServer = viewerCan(viewer, "MANAGE_SERVER");
  const canManageRoles = viewerCan(viewer, "MANAGE_ROLES");
  const canBanMembers = viewerCan(viewer, "BAN_MEMBERS");
  const canViewAudit = viewerCan(viewer, "VIEW_AUDIT_LOG");

  const tabs: { id: Tab; label: string; enabled: boolean }[] = [
    { id: "geral", label: "Geral", enabled: canManageServer },
    { id: "cargos", label: "Cargos", enabled: canManageRoles },
    { id: "membros", label: "Membros", enabled: canManageRoles },
    { id: "banimentos", label: "Banimentos", enabled: canBanMembers },
    { id: "registro", label: "Registro", enabled: canViewAudit },
  ];

  const first = tabs.find((tab) => tab.enabled)?.id ?? "geral";
  const [active, setActive] = useState<Tab>(first);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-1 border-b border-line">
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
        <GeneralTab
          serverId={serverId}
          serverName={serverName}
          serverIconUrl={serverIconUrl}
          members={members}
          viewer={viewer}
        />
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

      {active === "registro" && canViewAudit ? (
        <AuditTab
          serverId={serverId}
          initialEntries={audit.entries}
          initialHasMore={audit.hasMore}
        />
      ) : null}
    </div>
  );
}
