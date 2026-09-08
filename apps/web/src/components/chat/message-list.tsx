"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import type { PublicMessage } from "@aether/shared";
import {
  useChannelHistory,
  useChannelMessages,
  useRealtimeStore,
  type ChatMessage,
} from "@/lib/stores/realtime-store";
import { useSocket } from "@/components/realtime/realtime-provider";
import { usePrefsDoChat } from "@/lib/chat/prefs";
import { MessageGroup, type GrupoDeMensagens } from "./message-group";

/** Janela em que mensagens seguidas do mesmo autor viram um grupo so. */
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
   * antes do nome de uma pessoa faz a tela dizer "#LucasCR".
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

  const fontSize = usePrefsDoChat((p) => p.fontSize);
  const densidade = usePrefsDoChat((p) => p.densidade);
  const timestamps = usePrefsDoChat((p) => p.timestamps);

  /**
   * Enquanto a store nao foi semeada (primeiro render e hidratacao), usamos o
   * que veio do SSR. Sem isso a lista renderizaria vazia no servidor e cheia no
   * cliente — mismatch de hidratacao e um flash de tela vazia.
   */
  const messages: ChatMessage[] = stored.length > 0 ? stored : initialMessages;
  const grupos = useMemo(() => agrupar(messages), [messages]);

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
      data-density={densidade}
      data-chat-ts={timestamps}
      style={{ "--chat-font": `${fontSize}px` } as React.CSSProperties}
      className="chat-root flex-1 overflow-y-auto overscroll-contain"
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
        <ul className="py-3">
          {grupos.map((grupo) => (
            <MessageGroup key={grupo.chave} grupo={grupo} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Quebra a lista plana em grupos. Mesma pessoa, dentro da janela, sem falha de
 * envio no meio — a falha corta o grupo para o aviso de erro nao ficar orfao
 * embaixo de uma mensagem que deu certo.
 */
function agrupar(mensagens: ChatMessage[]): GrupoDeMensagens[] {
  const grupos: GrupoDeMensagens[] = [];

  for (const mensagem of mensagens) {
    const atual = grupos[grupos.length - 1];
    const anterior = atual?.mensagens[atual.mensagens.length - 1];

    if (
      atual &&
      anterior &&
      anterior.author.id === mensagem.author.id &&
      !anterior.failed &&
      dentroDaJanela(anterior, mensagem)
    ) {
      atual.mensagens.push(mensagem);
    } else {
      grupos.push({
        chave: mensagem.id,
        autor: mensagem.author,
        mensagens: [mensagem],
      });
    }
  }

  return grupos;
}

function dentroDaJanela(anterior: ChatMessage, atual: ChatMessage): boolean {
  const delta =
    new Date(atual.createdAt).getTime() - new Date(anterior.createdAt).getTime();
  return delta >= 0 && delta < GROUP_WINDOW_MS;
}
