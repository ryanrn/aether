import { notFound } from "next/navigation";
import type { ViewerContext } from "@aether/shared";
import { requireMember } from "@/server/guards";
import { getServerContext } from "@/server/services/servers";
import { ChannelSidebar } from "@/components/layout/channel-sidebar";
import { ControlBar } from "@/components/layout/control-bar";
import { MemberPanel } from "@/components/layout/member-panel";
import { TopBar } from "@/components/layout/top-bar";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { ConnectionBanner } from "@/components/realtime/connection-banner";
import { VoiceActivityMonitor } from "@/components/realtime/voice-activity-monitor";

/**
 * Casca do servidor.
 *
 * requireMember() e a fronteira de seguranca: quem nao e membro recebe 404 —
 * nao 403 — para nao vazar a existencia de servidores privados.
 *
 * O `viewer` que desce para o cliente carrega as permissoes apenas para
 * decidir o que RENDERIZAR. Toda action recalcula por conta propria.
 */
export default async function ServerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;

  let context;
  try {
    context = await requireMember(serverId);
  } catch {
    notFound();
  }

  const data = await getServerContext(serverId, context);
  if (!data) notFound();

  const viewer: ViewerContext = {
    memberId: context.memberId,
    isOwner: context.isOwner,
    permissions: context.permissions.toString(),
    roleIds: context.roleIds,
    highestRolePosition: context.isOwner
      ? Number.MAX_SAFE_INTEGER
      : context.highestRolePosition,
  };

  return (
    <RealtimeProvider serverId={serverId}>
      <div className="flex h-dvh min-w-0 flex-1 flex-col">
        <TopBar server={data.server} memberCount={data.members.length} viewer={viewer} />

        <ConnectionBanner />
        <VoiceActivityMonitor />

        <div className="flex min-h-0 flex-1">
          <ChannelSidebar
            serverId={serverId}
            categories={data.categories}
            looseChannels={data.looseChannels}
            roles={data.roles}
            viewer={viewer}
            channelPermissions={data.channelPermissions}
          />

          <main className="flex min-w-0 flex-1 flex-col bg-base-950">{children}</main>

          <MemberPanel
            members={data.members}
            roles={data.roles}
            ownerId={data.server.ownerId}
            serverId={serverId}
            viewer={viewer}
          />
        </div>

        <ControlBar user={context.session.user} viewer={viewer} />
      </div>
    </RealtimeProvider>
  );
}
