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
  ehConversaDireta = false,
}: {
  channelId: string;
  channelName: string;
  initialMessages: PublicMessage[];
  initialHasMore: boolean;
  selfUser: PublicUser;
  canSend: boolean;
  /** Repassado para a lista: conversa direta nao mostra "#". */
  ehConversaDireta?: boolean;
}) {
  const prependHistory = useRealtimeStore((state) => state.prependHistory);
  const setActiveChannel = useRealtimeStore((state) => state.setActiveChannel);

  useEffect(() => {
    prependHistory(channelId, initialMessages, initialHasMore);
  }, [channelId, initialMessages, initialHasMore, prependHistory]);

  /**
   * Enquanto este canal esta na tela, mensagem que chega nele nasce lida.
   * Ao sair, voltamos para "nenhum canal aberto" — senao o canal continuaria
   * marcando tudo como visto depois que voce foi embora.
   */
  useEffect(() => {
    setActiveChannel(channelId);
    return () => setActiveChannel(null);
  }, [channelId, setActiveChannel]);

  return (
    /**
     * O espaco embaixo NAO e respiro: e a area que a HUD flutuante ocupa.
     *
     * Ela mora no palco com `position: absolute`, ou seja, fora do fluxo — sem
     * reservar isto, o campo de mensagem fica DEBAIXO dela. Medido: a HUD tem
     * 54px de altura e flutua a 20px do fundo, entao 80px cobrem com folga.
     */
    <div className="flex min-h-0 flex-1 flex-col pb-20">
      <MessageList
        channelId={channelId}
        channelName={channelName}
        ehConversaDireta={ehConversaDireta}
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
