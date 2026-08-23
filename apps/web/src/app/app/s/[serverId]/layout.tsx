import { notFound } from "next/navigation";
import type { ViewerContext } from "@aether/shared";
import { requireMember } from "@/server/guards";
import { getServerContext } from "@/server/services/servers";
import { ChannelSidebar } from "@/components/layout/channel-sidebar";
import { ControlBar } from "@/components/layout/control-bar";
import { MemberPanel } from "@/components/layout/member-panel";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { ConnectionBanner } from "@/components/realtime/connection-banner";
import { GameActivityMonitor } from "@/components/realtime/game-activity-monitor";
import { VoiceActivityMonitor } from "@/components/realtime/voice-activity-monitor";
import { VoiceChimes } from "@/components/realtime/voice-chimes";
import { VoiceSession } from "@/components/realtime/voice-session";

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
      {/*
        Quatro colunas de altura inteira, sem barra atravessando o topo.
        A barra global saiu de proposito: com ela, a HUD tinha de ser um rodape
        de largura total, e o palco central nunca era uma regiao propria. Agora
        cada coluna tem o seu cabecalho de 48px e a HUD flutua DENTRO do centro.
      */}
      <div className="flex h-dvh min-w-0 flex-1 flex-col">
        <ConnectionBanner />
        <VoiceActivityMonitor />
        <GameActivityMonitor />
        <VoiceChimes />
        <VoiceSession />

        <div className="flex min-h-0 flex-1">
          <ChannelSidebar
            serverId={serverId}
            serverName={data.server.name}
            categories={data.categories}
            looseChannels={data.looseChannels}
            roles={data.roles}
            viewer={viewer}
            channelPermissions={data.channelPermissions}
          />

          {/*
            `relative` existe para a HUD: ela ancora NESTE palco, e nao na
            janela. Ficar presa a janela era o que a transformava em rodape.
          */}
          <main className="relative flex min-w-0 flex-1 flex-col bg-base-950">
            {children}

            <ControlBar
              user={context.session.user}
              viewer={viewer}
              serverId={serverId}
              memberId={context.memberId}
              voiceChannels={[
                ...data.looseChannels,
                ...data.categories.flatMap((category) => category.channels),
              ].filter((channel) => channel.type === "VOICE")}
              nickname={
                data.members.find((member) => member.id === context.memberId)
                  ?.nickname ?? null
              }
            />
          </main>

          <MemberPanel
            members={data.members}
            roles={data.roles}
            ownerId={data.server.ownerId}
            serverId={serverId}
            serverName={data.server.name}
            /* O cartao de atividade mostra o NOME do canal ocupado; o estado
               de voz so carrega o id. */
            voiceChannels={[
              ...data.looseChannels,
              ...data.categories.flatMap((category) => category.channels),
            ].filter((channel) => channel.type === "VOICE")}
            viewer={viewer}
          />
        </div>

      </div>
    </RealtimeProvider>
  );
}
