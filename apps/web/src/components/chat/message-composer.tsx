"use client";

import { useRef, useState } from "react";
import { SendHorizontal } from "lucide-react";
import type { PublicUser } from "@aether/shared";
import {
  useConnectionStatus,
  useRealtimeStore,
} from "@/lib/stores/realtime-store";
import { useSocket } from "@/components/realtime/realtime-provider";
import { cn } from "@/lib/utils";

/**
 * Campo de envio.
 *
 * O envio e otimista: a mensagem aparece imediatamente marcada como pendente e
 * so entao o gateway confirma. O `nonce` gerado aqui e o que liga a linha
 * otimista a mensagem real — sem ele, reconectar no meio de um envio faria a
 * mensagem aparecer duas vezes.
 *
 * A validacao de tamanho tambem roda no servidor (mesmo schema Zod). O que
 * fazemos aqui e evitar a ida de rede inutil, nao decidir o que e valido.
 */
const MAX_LENGTH = 4000;

export function MessageComposer({
  channelId,
  channelName,
  selfUser,
  canSend,
}: {
  channelId: string;
  channelName: string;
  selfUser: PublicUser;
  canSend: boolean;
}) {
  const socket = useSocket();
  const status = useConnectionStatus();
  const connected = status === "online";
  const addPending = useRealtimeStore((state) => state.addPending);
  const failPending = useRealtimeStore((state) => state.failPending);
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const disabled = !canSend || !connected;
  const tooLong = value.length > MAX_LENGTH;

  function send() {
    const content = value.trim();
    if (!content || tooLong || disabled || !socket) return;

    const nonce =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    addPending({
      id: nonce,
      conversationId: channelId,
      content,
      author: selfUser,
      createdAt: new Date().toISOString(),
      editedAt: null,
      pending: true,
      nonce,
    });

    setValue("");
    resetHeight();

    socket.emit("message:send", { conversationId: channelId, content, nonce }, (result) => {
      // O sucesso chega pelo evento message:new (que tambem atende as outras
      // abas); aqui so tratamos a falha.
      if (!result.ok) failPending(channelId, nonce, result.error);
    });
  }

  function resetHeight() {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
  }

  function grow() {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }

  return (
    <div className="shrink-0 px-4 pb-4 pt-1">
      <div
        className={cn(
          "flex items-end gap-2 rounded-lg border bg-base-900 px-3 py-2 transition-colors",
          tooLong
            ? "border-signal-dnd/50"
            : "border-base-700 focus-within:border-base-600",
          disabled && "opacity-60",
        )}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            setValue(event.target.value);
            grow();
          }}
          onKeyDown={(event) => {
            // Enter envia; Shift+Enter quebra linha. IME em composicao nao
            // pode enviar no meio de uma palavra sendo montada.
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={
            !canSend
              ? "Seu cargo nao permite enviar mensagens aqui"
              : status === "offline"
                ? "Sem conexao com o tempo real"
                : `Mensagem em #${channelName}`
          }
          aria-label={`Mensagem em ${channelName}`}
          className="max-h-[180px] min-h-[22px] flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-ink-200 outline-none placeholder:text-ink-600 disabled:cursor-not-allowed"
        />

        <button
          type="button"
          onClick={send}
          disabled={disabled || value.trim().length === 0 || tooLong}
          aria-label="Enviar mensagem"
          className="mb-[1px] grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-500 transition-colors hover:bg-base-800 hover:text-accent-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-500"
        >
          <SendHorizontal className="h-4 w-4" />
        </button>
      </div>

      {tooLong ? (
        <p className="mt-1.5 px-1 text-[11px] text-signal-dnd">
          {value.length} / {MAX_LENGTH} caracteres
        </p>
      ) : null}
    </div>
  );
}
