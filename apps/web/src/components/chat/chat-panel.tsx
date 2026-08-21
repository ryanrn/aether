"use client";

import { useEffect } from "react";
import type { PublicMessage, PublicUser } from "@aether/shared";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { MessageList } from "./message-list";
import { MessageComposer } from "./message-composer";

/**
 * Junta lista e campo de envio, e semeia a store com o historico que veio do
 * SSR.
 *
 * A semeadura e um merge por id, nao uma substituicao: se o socket ja entregou
 * mensagens novas enquanto a pagina carregava, elas nao podem ser descartadas
 * pelo historico mais velho que chegou junto do HTML.
 */
export function ChatPanel({
  channelId,
  channelName,
  initialMessages,
  initialHasMore,
  selfUser,
  canSend,
}: {
  channelId: string;
  channelName: string;
  initialMessages: PublicMessage[];
  initialHasMore: boolean;
  selfUser: PublicUser;
  canSend: boolean;
}) {
  const prependHistory = useRealtimeStore((state) => state.prependHistory);

  useEffect(() => {
    prependHistory(channelId, initialMessages, initialHasMore);
  }, [channelId, initialMessages, initialHasMore, prependHistory]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageList
        channelId={channelId}
        channelName={channelName}
        initialMessages={initialMessages}
      />
      <MessageComposer
        channelId={channelId}
        channelName={channelName}
        selfUser={selfUser}
        canSend={canSend}
      />
    </div>
  );
}
