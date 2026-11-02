"use client";

import { Avatar } from "@/components/ui/avatar";
import { AvatarDecorado } from "@/components/profile/avatar-decorado";
import { SeloPlano } from "@/components/ui/selo-plano";
import { SeloBot } from "@/components/ui/selo-bot";
import { usePrefsDoChat } from "@/lib/chat/prefs";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import { cn } from "@/lib/utils";
import { MessageItem } from "./message-item";
import type { ChatMessage } from "@/lib/stores/realtime-store";
import type { PublicUser } from "@aether/shared";

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

export function MessageGroup({
  grupo,
  ehConversaDireta = false,
  onAbrirPerfil,
  onPreCarregarPerfil,
  onResponder,
  onIrParaMensagem,
}: {
  grupo: GrupoDeMensagens;
  /**
   * DM nao tem cargo — nunca colore o nome, mesmo que o outro participante
   * tambem seja membro de algum servidor que voce tenha aberto por ultimo (o
   * mapa de cores e do SERVIDOR, `corPorMembro` continuaria com a entrada dele
   * de la).
   */
  ehConversaDireta?: boolean;
  /** ausente = so no preview de configuracoes, onde o cartao nao faz sentido */
  onAbrirPerfil?: (user: PublicUser, ancora: DOMRect) => void;
  /** ponteiro no avatar/nome -> o cartao abre ja com banner */
  onPreCarregarPerfil?: (userId: string) => void;
  onResponder?: (message: GrupoDeMensagens["mensagens"][number]) => void;
  onIrParaMensagem?: (id: string) => void;
}) {
  const tamanhoAvatar = usePrefsDoChat((p) => p.tamanhoAvatar);
  const corDoCargo = useRealtimeStore((s) =>
    ehConversaDireta ? undefined : s.corPorMembro[grupo.autor.id],
  );
  const primeira = grupo.mensagens[0];
  if (!primeira) return null;
  const inicio = new Date(primeira.createdAt);

  const abrir = (evento: React.MouseEvent) =>
    onAbrirPerfil?.(
      grupo.autor,
      evento.currentTarget.getBoundingClientRect(),
    );

  /**
   * O `mousedown` NAO pode chegar ao `document`: o cartao fecha ao clicar fora,
   * e sem isto clicar de novo no mesmo nome faria o cartao fechar (mousedown) e
   * reabrir (click) — nunca alternando.
   */
  const semPropagar = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className="chat-group relative px-4"
      style={{ paddingLeft: "calc(1rem + var(--chat-gutter))" }}
    >
      <button
        type="button"
        onClick={abrir}
        onMouseDown={semPropagar}
        onPointerEnter={() => onPreCarregarPerfil?.(grupo.autor.id)}
        aria-label={`Perfil de ${grupo.autor.displayName}`}
        className="absolute left-4 top-0 rounded-full transition-transform hover:scale-105"
      >
        {grupo.autor.decoracao ? (
          <AvatarDecorado
            userId={grupo.autor.id}
            name={grupo.autor.displayName}
            src={grupo.autor.avatarUrl}
            moldura={grupo.autor.moldura}
            px={tamanhoAvatar}
            decoracao={{
              frenteUrl: grupo.autor.decoracao.frente,
              trasUrl: grupo.autor.decoracao.tras,
            }}
          />
        ) : (
          <Avatar
            userId={grupo.autor.id}
            name={grupo.autor.displayName}
            src={grupo.autor.avatarUrl}
            moldura={grupo.autor.moldura}
            size={tamanhoAvatar >= 44 ? "lg" : "md"}
            px={tamanhoAvatar}
          />
        )}
      </button>

      <div className="flex items-baseline gap-2">
        <button
          type="button"
          onClick={abrir}
          onMouseDown={semPropagar}
          onPointerEnter={() => onPreCarregarPerfil?.(grupo.autor.id)}
          className={cn(
            "text-[13px] font-semibold hover:underline",
            !corDoCargo && "text-ink-100",
          )}
          style={corDoCargo ? { color: corDoCargo } : undefined}
        >
          {grupo.autor.displayName}
        </button>
        <SeloBot kind={grupo.autor.kind} />
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
            onResponder={onResponder}
            onIrParaMensagem={onIrParaMensagem}
          />
        ))}
      </div>
    </div>
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
