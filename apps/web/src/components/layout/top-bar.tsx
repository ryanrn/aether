import Link from "next/link";
import { Settings, Users } from "lucide-react";
import type { PublicServer, ViewerContext } from "@aether/shared";
import { BRAND } from "@aether/shared";
import { InviteButton } from "@/components/servers/invite-button";
import { viewerCan } from "@/lib/permissions";

export function TopBar({
  server,
  memberCount,
  viewer,
}: {
  server: PublicServer;
  memberCount: number;
  viewer: ViewerContext;
}) {
  const canInvite = viewerCan(viewer, "CREATE_INVITE");
  const canManage =
    viewerCan(viewer, "MANAGE_SERVER") ||
    viewerCan(viewer, "MANAGE_ROLES") ||
    viewer.isOwner;

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-base-800 bg-base-900 px-4">
      <span className="hidden font-mono text-[11px] tracking-[0.22em] text-ink-500 sm:inline">
        {BRAND.name}
      </span>
      <span className="hidden h-4 w-px bg-base-700 sm:inline" />

      <h1 className="truncate text-[13px] font-medium text-ink-100">{server.name}</h1>

      <span className="flex items-center gap-1.5 rounded-sm border border-base-700 px-2 py-0.5 text-[11px] text-ink-400">
        <Users className="h-3 w-3" />
        {memberCount}
      </span>

      <div className="ml-auto flex items-center gap-2">
        {canInvite ? <InviteButton serverId={server.id} /> : null}
        {canManage ? (
          <Link
            href={`/app/s/${server.id}/settings`}
            title="Configuracoes do servidor"
            className="grid h-8 w-8 place-items-center rounded-md text-ink-400 transition-colors hover:bg-base-800 hover:text-ink-100"
          >
            <Settings className="h-4 w-4" />
          </Link>
        ) : null}
      </div>
    </header>
  );
}
