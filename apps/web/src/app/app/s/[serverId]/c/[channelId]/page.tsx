import { notFound } from "next/navigation";
import { Hash, Lock, Volume2 } from "lucide-react";
import { prisma } from "@aether/db";
import { getChannelPermissions } from "@aether/access";
import { has, type PublicChannel, type PublicUser } from "@aether/shared";
import { requireMember } from "@/server/guards";
import { listRecentMessages } from "@/server/services/messages";
import { EmptyState } from "@/components/layout/empty-state";
import { ChatPanel } from "@/components/chat/chat-panel";
import { VoiceStage } from "@/components/voice/voice-stage";
import { NavToggle } from "@/components/layout/nav-mobile";

/**
 * Pagina do canal.
 *
 * A visibilidade e checada AQUI tambem, nao apenas na arvore: alguem pode
 * chegar por URL direta a um canal privado que nunca apareceu na sidebar.
 * Sem VIEW_CHANNEL o canal responde 404, como se nao existisse.
 *
 * O historico do chat vem daqui, no SSR, e nao pelo socket: a pagina ja fala
 * com o banco, entao carregar as primeiras mensagens junto evita tela vazia
 * piscando. O socket cuida do que chega depois.
 */
export default async function ChannelPage({
  params,
}: {
  params: Promise<{ serverId: string; channelId: string }>;
}) {
  const { serverId, channelId } = await params;

  let context;
  try {
    context = await requireMember(serverId);
  } catch {
    notFound();
  }

  const permissions = await getChannelPermissions(context, channelId);
  if (permissions === null || !has(permissions, "VIEW_CHANNEL")) notFound();

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, serverId },
    select: {
      id: true,
      name: true,
      topic: true,
      type: true,
      categoryId: true,
      position: true,
      isPrivate: true,
      isTemporary: true,
      userLimit: true,
    },
  });
  if (!channel) notFound();

  const publicChannel: PublicChannel = channel;
  const Icon = channel.isPrivate ? Lock : channel.type === "VOICE" ? Volume2 : Hash;
  const canConnect = has(permissions, "CONNECT");
  const canSend = has(permissions, "SEND_MESSAGES");

  // O email da sessao nao desce para componente de cliente.
  const selfUser: PublicUser = {
    id: context.session.user.id,
    username: context.session.user.username,
    displayName: context.session.user.displayName,
    avatarUrl: context.session.user.avatarUrl,
    status: context.session.user.status,
  };

  const history =
    channel.type === "TEXT"
      ? await listRecentMessages(channel.id, selfUser.id)
      : { messages: [], hasMore: false };

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-base-800 px-5">
        <NavToggle />
        <Icon className="h-4 w-4 text-ink-500" />
        <span className="text-[13px] font-medium text-ink-100">{channel.name}</span>
        {channel.topic ? (
          <>
            <span className="h-4 w-px bg-base-700" />
            <span className="truncate text-[12px] text-ink-400">{channel.topic}</span>
          </>
        ) : null}
        {channel.isPrivate ? (
          <span className="ml-2 rounded-[3px] border border-signal-idle/30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-signal-idle">
            privado
          </span>
        ) : null}
      </div>

      {channel.type === "TEXT" ? (
        <ChatPanel
          channelId={channel.id}
          channelName={channel.name}
          initialMessages={history.messages}
          initialHasMore={history.hasMore}
          selfUser={selfUser}
          canSend={canSend}
        />
      ) : canConnect ? (
        <VoiceStage
          channel={publicChannel}
          selfUserId={selfUser.id}
          canConnect={canConnect}
        />
      ) : (
        <EmptyState
          title={channel.name}
          description="Voce pode ver este canal, mas seu cargo nao permite conectar na voz."
        />
      )}
    </>
  );
}
