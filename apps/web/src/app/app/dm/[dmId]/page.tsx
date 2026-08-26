import { notFound } from "next/navigation";
import { prisma } from "@aether/db";
import { loadDmAccess } from "@aether/access";
import type { PublicUser } from "@aether/shared";
import { getSession } from "@/server/auth/session";
import { listRecentDmMessages } from "@/server/services/messages";
import { ChatPanel } from "@/components/chat/chat-panel";
import { Avatar } from "@/components/ui/avatar";

/**
 * Pagina de uma conversa direta.
 *
 * O id da conversa VIAJA NA URL, entao ele nao e segredo e nao pode ser a
 * defesa. Quem decide e `loadDmAccess`, a mesma funcao que o gateway usa: voce
 * e um dos dois, e voces ainda sao amigos. Duas copias dessa regra divergiriam,
 * e a que ficasse para tras seria a falha.
 *
 * Responde 404 tanto para conversa inexistente quanto para conversa alheia.
 * Distinguir as duas ja contaria que duas pessoas especificas se falam.
 */
export default async function DmPage({
  params,
}: {
  params: Promise<{ dmId: string }>;
}) {
  const { dmId } = await params;

  const session = await getSession();
  if (!session) notFound();

  const acesso = await loadDmAccess(session.user.id, dmId);
  if (!acesso) notFound();

  const outro = await prisma.user.findUnique({
    where: { id: acesso.outroId },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      status: true,
    },
  });
  if (!outro) notFound();

  // O email da sessao nao desce para componente de cliente.
  const selfUser: PublicUser = {
    id: session.user.id,
    username: session.user.username,
    displayName: session.user.displayName,
    avatarUrl: session.user.avatarUrl,
    status: session.user.status,
  };

  const history = await listRecentDmMessages(dmId, session.user.id);

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-base-800 px-5">
        <Avatar
          userId={outro.id}
          name={outro.displayName}
          src={outro.avatarUrl}
          status={outro.status}
          size="sm"
          round
          // O cabecalho fica sobre `base-900`; o anel do ponto acompanha.
          ring="border-base-900"
        />
        <span className="text-[13px] font-medium text-ink-100">
          {outro.displayName}
        </span>
        <span className="text-[12px] text-ink-500">@{outro.username}</span>
      </div>

      {/*
        `channelId` recebe o id da CONVERSA. O nome da prop e do tempo em que
        so havia canal de servidor; o painel sempre tratou o valor como chave
        opaca — ele nunca busca um `Channel` com isso.
      */}
      <ChatPanel
        channelId={dmId}
        channelName={outro.displayName}
        initialMessages={history.messages}
        initialHasMore={history.hasMore}
        selfUser={selfUser}
        canSend
        ehConversaDireta
      />
    </>
  );
}
