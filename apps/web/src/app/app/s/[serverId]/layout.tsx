import { notFound } from "next/navigation";
import type { ViewerContext } from "@aether/shared";
import { requireMember } from "@/server/guards";
import { getServerContext } from "@/server/services/servers";
import { ChannelSidebar } from "@/components/layout/channel-sidebar";
import { ControlBar } from "@/components/layout/control-bar";
import { prisma } from "@aether/db";
import { MemberPanel } from "@/components/layout/member-panel";
import { ConnectionBanner } from "@/components/realtime/connection-banner";
import { GameActivityMonitor } from "@/components/realtime/game-activity-monitor";
import { VoiceActivityMonitor } from "@/components/realtime/voice-activity-monitor";
import { VoiceChimes } from "@/components/realtime/voice-chimes";

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

  /**
   * Quem ja tem alguma relacao comigo: amizade (aceita ou pendente, nos dois
   * sentidos) ou bloqueio. O cartao do membro usa para nao oferecer
   * "adicionar amigo" a quem ja e amigo, ja recebeu pedido ou esta bloqueado.
   */
  const jaRelacionados = new Set<string>();
  {
    const eu = context.session.user.id;
    const [amizades, bloqueios] = await Promise.all([
      prisma.friendship.findMany({
        where: { OR: [{ requesterId: eu }, { addresseeId: eu }] },
        select: { requesterId: true, addresseeId: true },
      }),
      prisma.block.findMany({
        where: { OR: [{ blockerId: eu }, { blockedId: eu }] },
        select: { blockerId: true, blockedId: true },
      }),
    ]);
    for (const a of amizades) {
      jaRelacionados.add(a.requesterId === eu ? a.addresseeId : a.requesterId);
    }
    for (const b of bloqueios) {
      jaRelacionados.add(b.blockerId === eu ? b.blockedId : b.blockerId);
    }
  }
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
    <>
      {/*
        Quatro colunas de altura inteira, sem barra atravessando o topo.
        A barra global saiu de proposito: com ela, a HUD tinha de ser um rodape
        de largura total, e o palco central nunca era uma regiao propria. Agora
        cada coluna tem o seu cabecalho de 48px e a HUD flutua DENTRO do centro.
      */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <ConnectionBanner />
        <VoiceActivityMonitor />
        <GameActivityMonitor />
        <VoiceChimes />

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
            /*
              Quem JA tem relacao comigo — amigo aceito, pedido pendente em
              qualquer direcao, ou bloqueio. O cartao usa para nao oferecer
              "adicionar amigo" a quem ja e amigo.

              Calculado AQUI, no servidor, e nao no store do cliente: quem sabe
              montar "pendente/aceito" e o banco, e uma copia no navegador
              seria uma segunda versao da mesma consulta — a mesma razao pela
              qual `friend:changed` so pede a tela nova em vez de mandar o que
              mudou.
            */
            jaRelacionados={jaRelacionados}
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
    </>
  );
}
