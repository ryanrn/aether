"use client";

import { Avatar } from "@/components/ui/avatar";
import { SeloPlano } from "@/components/ui/selo-plano";
import { usePrefsDoChat } from "@/lib/chat/prefs";
import { MessageItem } from "./message-item";
import type { ChatMessage } from "@/lib/stores/realtime-store";

/**
 * Um GRUPO de mensagens seguidas da mesma pessoa.
 *
 * O que da ritmo ao chat: em vez de repetir avatar, nome e horario em cada
 * linha, eles aparecem UMA vez no topo do grupo, e as mensagens seguintes
 * ficam alinhadas na mesma coluna. O espaco entre grupos e maior que o espaco
 * entre mensagens do mesmo grupo — `--chat-gap-*`, definido por `data-density`
 * no container da lista.
 *
 * O avatar fica `absolute` na sarjeta (`--chat-gutter`): assim o corpo ocupa a
 * largura toda e cada `<MessageItem>` pode mostrar o proprio horario de hover
 * ali, sem empurrar o texto.
 */
export interface GrupoDeMensagens {
  chave: string;
  autor: ChatMessage["author"];
  mensagens: ChatMessage[];
}

export function MessageGroup({ grupo }: { grupo: GrupoDeMensagens }) {
  const tamanhoAvatar = usePrefsDoChat((p) => p.tamanhoAvatar);
  const primeira = grupo.mensagens[0];
  if (!primeira) return null;
  const inicio = new Date(primeira.createdAt);

  return (
    <li
      className="chat-group relative px-4"
      style={{ paddingLeft: "calc(1rem + var(--chat-gutter))" }}
    >
      <div className="absolute left-4 top-0">
        <Avatar
          userId={grupo.autor.id}
          name={grupo.autor.displayName}
          src={grupo.autor.avatarUrl}
          moldura={grupo.autor.moldura}
          size={tamanhoAvatar >= 36 ? "md" : "sm"}
          px={tamanhoAvatar}
        />
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-semibold text-ink-100">
          {grupo.autor.displayName}
        </span>
        <SeloPlano tier={grupo.autor.plano} tamanho="sm" />
        <time
          dateTime={primeira.createdAt}
          suppressHydrationWarning
          className="chat-group__hora font-mono text-[10px] text-ink-500"
        >
          {formatarCabecalho(inicio)}
        </time>
      </div>

      <div className="chat-group__corpo mt-[3px]">
        {grupo.mensagens.map((mensagem, indice) => (
          <MessageItem
            key={mensagem.id}
            message={mensagem}
            primeira={indice === 0}
          />
        ))}
      </div>
    </li>
  );
}

/** "hoje 14:03" / "07/09 14:03" — mesmo formato que a lista ja usava. */
function formatarCabecalho(date: Date): string {
  const hora = date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const hoje = new Date();
  if (date.toDateString() === hoje.toDateString()) return `hoje ${hora}`;
  return (
    date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) +
    ` ${hora}`
  );
}
