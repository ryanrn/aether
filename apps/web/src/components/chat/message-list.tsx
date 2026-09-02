"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import type { PublicMessage } from "@aether/shared";
import {
  useChannelHistory,
  useChannelMessages,
  useRealtimeStore,
  type ChatMessage,
} from "@/lib/stores/realtime-store";
import { useSocket } from "@/components/realtime/realtime-provider";
import { MessageItem } from "./message-item";

/** Janela em que mensagens seguidas do mesmo autor viram um bloco so. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;
/** Distancia do fim em que ainda consideramos que a pessoa esta "acompanhando". */
const STICK_THRESHOLD_PX = 120;
/** Distancia do topo que dispara o carregamento de mensagens antigas. */
const LOAD_MORE_THRESHOLD_PX = 80;

export function MessageList({
  channelId,
  initialMessages,
  channelName,
  ehConversaDireta = false,
}: {
  channelId: string;
  initialMessages: PublicMessage[];
  channelName: string;
  /**
   * Conversa direta nao leva "#": o prefixo e o simbolo de CANAL, e coloca-lo
   * antes do nome de uma pessoa faz a tela dizer "#LucasCR", que le como se
   * existisse um canal com o nome dela.
   */
  ehConversaDireta?: boolean;
}) {
  const socket = useSocket();
  const stored = useChannelMessages(channelId);
  const { hasMore, loading } = useChannelHistory(channelId);
  const prependHistory = useRealtimeStore((state) => state.prependHistory);
  const setHistoryLoading = useRealtimeStore(
    (state) => state.setHistoryLoading,
  );

  /**
   * Enquanto a store nao foi semeada (primeiro render e hidratacao), usamos o
   * que veio do SSR. Sem isso a lista renderizaria vazia no servidor e cheia
   * no cliente — mismatch de hidratacao e um flash de tela vazia.
   */
  const messages: ChatMessage[] = stored.length > 0 ? stored : initialMessages;

  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  /** altura antes de prepender historico, para nao deslocar o que a pessoa le */
  const restoreHeight = useRef<number | null>(null);

  const handleScroll = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;

    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottom.current = distanceFromBottom < STICK_THRESHOLD_PX;

    if (
      element.scrollTop < LOAD_MORE_THRESHOLD_PX &&
      hasMore &&
      !loading &&
      socket?.connected
    ) {
      const oldest = messages[0];
      if (!oldest) return;

      setHistoryLoading(channelId, true);
      restoreHeight.current = element.scrollHeight;

      socket.emit(
        "message:history",
        { conversationId: channelId, before: oldest.id },
        (result) => {
          if (!result.ok) {
            setHistoryLoading(channelId, false);
            return;
          }
          prependHistory(channelId, result.messages, result.hasMore);
        },
      );
    }
  }, [
    channelId,
    hasMore,
    loading,
    messages,
    prependHistory,
    setHistoryLoading,
    socket,
  ]);

  // Rolagem: gruda no fim quando a pessoa esta acompanhando; ao carregar
  // historico, mantem a leitura no mesmo ponto em vez de saltar.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    if (restoreHeight.current !== null) {
      element.scrollTop = element.scrollHeight - restoreHeight.current;
      restoreHeight.current = null;
      return;
    }
    if (stickToBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages]);

  // Trocar de canal sempre comeca no fim
  useEffect(() => {
    stickToBottom.current = true;
    const element = containerRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [channelId]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overscroll-contain"
    >
      {loading ? (
        <div className="flex justify-center py-3">
          <AetherIcon
            name="loader"
            className="h-4 w-4 animate-spin text-ink-600"
          />
        </div>
      ) : null}

      {!hasMore && messages.length > 0 ? (
        <p className="px-4 py-6 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-ink-600">
          inicio de {ehConversaDireta ? "" : "#"}
          {channelName}
        </p>
      ) : null}

      {messages.length === 0 ? (
        <div className="flex h-full items-center justify-center px-8">
          <p className="max-w-[360px] text-balance text-center text-[13px] leading-relaxed text-ink-500">
            Nenhuma mensagem em{" "}
            <span className="text-ink-300">
              {ehConversaDireta ? "" : "#"}
              {channelName}
            </span>{" "}
            ainda. Escreva a primeira.
          </p>
        </div>
      ) : (
        <ul className="pb-4 pt-2">
          {messages.map((message, index) => (
            <MessageItem
              key={message.id}
              message={message}
              compact={isGrouped(messages[index - 1], message)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Mesma pessoa, dentro da janela, sem falha de envio no meio. */
function isGrouped(
  previous: ChatMessage | undefined,
  current: ChatMessage,
): boolean {
  if (!previous) return false;
  if (previous.author.id !== current.author.id) return false;
  if (previous.failed) return false;
  const delta =
    new Date(current.createdAt).getTime() -
    new Date(previous.createdAt).getTime();
  return delta >= 0 && delta < GROUP_WINDOW_MS;
}
