import { notFound } from "next/navigation";
import { Hash, Lock, Volume2 } from "lucide-react";
import { prisma } from "@aether/db";
import type { PublicChannel } from "@aether/shared";
import { requireMember } from "@/server/guards";
import { getChannelPermissions } from "@aether/access";
import { has } from "@aether/shared";
import { EmptyState } from "@/components/layout/empty-state";
import { VoiceStage } from "@/components/voice/voice-stage";

/**
 * Pagina do canal.
 *
 * A visibilidade e checada AQUI tambem, nao apenas na arvore: alguem pode
 * chegar por URL direta a um canal privado que nunca apareceu na sidebar.
 * Sem VIEW_CHANNEL o canal responde 404, como se nao existisse.
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

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-base-800 px-4">
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
        <EmptyState
          title={`#${channel.name}`}
          description="O chat em tempo real entra na fase 3, junto com o gateway WebSocket. O canal ja existe, ja tem permissoes e ja respeita canais privados."
        />
      ) : canConnect ? (
        // participantes ficam vazios ate a fase 4 alimentar o estado de voz
        <VoiceStage
          channel={publicChannel}
          participants={[]}
          selfUserId={context.session.user.id}
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
