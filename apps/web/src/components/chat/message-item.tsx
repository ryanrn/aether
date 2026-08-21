"use client";

import { AlertCircle } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/stores/realtime-store";

/**
 * Uma mensagem.
 *
 * `compact` e a continuacao de quem ja falou: some o avatar e o cabecalho e
 * fica so a linha de texto, alinhada na mesma coluna. E o que da ritmo ao
 * chat sem repetir o nome cinco vezes seguidas.
 *
 * O conteudo entra como texto puro. Nao existe dangerouslySetInnerHTML aqui —
 * o React escapa por padrao, entao HTML ou script colado numa mensagem aparece
 * como texto e nao executa.
 */
export function MessageItem({
  message,
  compact,
}: {
  message: ChatMessage;
  compact: boolean;
}) {
  const time = new Date(message.createdAt);

  return (
    <li
      className={cn(
        "group/message relative px-4 transition-colors hover:bg-base-900/40",
        compact ? "py-0.5" : "mt-3 py-0.5 first:mt-0",
        message.pending && "opacity-55",
      )}
    >
      <div className="flex gap-3">
        <div className="w-8 shrink-0">
          {compact ? (
            // Horario aparece no hover, ocupando o lugar do avatar
            <time
              dateTime={message.createdAt}
              suppressHydrationWarning
              className="mt-[3px] hidden justify-end pr-0.5 text-right font-mono text-[10px] leading-5 text-ink-600 group-hover/message:flex"
            >
              {formatTime(time)}
            </time>
          ) : (
            <Avatar
              userId={message.author.id}
              name={message.author.displayName}
              src={message.author.avatarUrl}
              size="sm"
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {compact ? null : (
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-medium text-ink-100">
                {message.author.displayName}
              </span>
              <time
                dateTime={message.createdAt}
                suppressHydrationWarning
                className="font-mono text-[10px] text-ink-600"
              >
                {formatDateTime(time)}
              </time>
              {message.editedAt ? (
                <span className="font-mono text-[10px] text-ink-600">
                  (editado)
                </span>
              ) : null}
            </div>
          )}

          <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-300">
            {message.content}
          </p>

          {message.failed ? (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-signal-dnd">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {message.failed}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/**
 * Formatacao roda no fuso de quem le. No servidor o fuso e outro, entao o
 * `suppressHydrationWarning` acima e proposital: a diferenca e esperada e a
 * correcao acontece na hidratacao.
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(date: Date): string {
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return `hoje ${formatTime(date)}`;
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }) + ` ${formatTime(date)}`;
}
