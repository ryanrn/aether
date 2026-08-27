"use client";

import { useState } from "react";
import { AlertCircle, SmilePlus } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import { useSocket } from "@/components/realtime/realtime-provider";
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
  const socket = useSocket();
  const [seletor, setSeletor] = useState<{ x: number; y: number } | null>(null);

  /**
   * Alterna a reacao. O servidor decide se e para ligar ou desligar — o
   * cliente so diz "este emoji, nesta mensagem".
   *
   * Sem estado otimista de proposito: a resposta chega pelo `reaction:update`,
   * que traz a lista INTEIRA e ja e a verdade. Pintar antes e corrigir depois
   * faria o botao piscar quando duas pessoas reagem quase junto.
   */
  const [erroReacao, setErroReacao] = useState<string | null>(null);

  function alternar(emoji: string) {
    setErroReacao(null);
    socket?.emit(
      "reaction:toggle",
      { messageId: message.id, emoji },
      (resultado) => {
        /**
         * A RECUSA PRECISA APARECER. A primeira versao passava `() => {}` e
         * engolia o `ack` — limite de reacoes atingido, permissao perdida no
         * meio, mensagem apagada: tudo virava "cliquei e nao aconteceu nada",
         * que a pessoa le como travamento.
         */
        if (!resultado.ok) setErroReacao(resultado.error);
      },
    );
  }

  // Mensagem que ainda nao existe no banco nao pode receber reacao.
  const podeReagir = socket !== null && !message.pending && !message.failed;

  return (
    <li
      className={cn(
        "group/message relative px-4 transition-colors hover:bg-base-900/40",
        compact ? "py-0.5" : "mt-3 py-0.5 first:mt-0",
        message.pending && "opacity-55",
      )}
    >
      {/*
        Acao FLUTUANTE, ancorada no canto da mensagem. `absolute` de proposito:
        no fluxo, ela mudaria a altura de toda mensagem — e como ela depende do
        socket, essa mudanca chegaria de repente ao conectar.
      */}
      {podeReagir ? (
        <button
          type="button"
          onClick={(evento) => {
            const r = evento.currentTarget.getBoundingClientRect();
            setSeletor({ x: r.left - 340, y: r.bottom + 6 });
          }}
          title="Reagir"
          aria-label="Reagir a esta mensagem"
          className={cn(
            "absolute right-4 top-0 z-10 grid h-6 w-6 place-items-center rounded-md",
            "border border-base-700 bg-base-850 text-ink-400 shadow-sm",
            "opacity-0 transition-opacity duration-150",
            "group-hover/message:opacity-100 focus:opacity-100 hover:text-ink-100",
          )}
        >
          <SmilePlus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      ) : null}

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

          {/*
            `select-text` porque a interface inteira nasce nao selecionavel
            (ver globals.css). Conteudo de mensagem e o caso mais obvio de algo
            que precisa ser copiavel — e o unico jeito de citar alguem.
          */}
          <p className="select-text whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-300">
            {message.content}
          </p>

          {/*
            A FILEIRA SO EXISTE QUANDO HA REACAO.
            
            A primeira versao renderizava a fileira sempre que se PODIA reagir,
            com o botao invisivel por `opacity-0` — mas invisivel ainda ocupa
            altura. Pior: `podeReagir` depende do socket, que comeca nulo e
            conecta depois. O resultado era a pagina carregar compacta e, ao
            conectar, TODA mensagem ganhar uma faixa de uma vez — a conversa
            inteira pulava para baixo. E repetia a cada reconexao.
            
            Agora a fileira so aparece com reacao de verdade, e o botao de
            reagir virou acao flutuante (abaixo), fora do fluxo.
          */}
          {message.reactions.length > 0 ? (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {message.reactions.map((reacao) => (
                <button
                  key={reacao.emoji}
                  type="button"
                  disabled={!podeReagir}
                  onClick={() => alternar(reacao.emoji)}
                  title={reacao.mine ? "Tirar sua reacao" : "Reagir tambem"}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[12px] leading-none",
                    "transition-colors duration-150 disabled:cursor-not-allowed",
                    reacao.mine
                      ? "border-accent-600/60 bg-accent-600/15 text-accent-300"
                      : "border-base-700 bg-base-800/60 text-ink-300 hover:border-base-600",
                  )}
                >
                  <span className="text-[13px]">{reacao.emoji}</span>
                  <span className="font-mono tabular-nums">{reacao.count}</span>
                </button>
              ))}
            </div>
          ) : null}

          {seletor ? (
            <EmojiPicker
              anchor={seletor}
              onEscolher={(emoji) => {
                alternar(emoji);
                setSeletor(null);
              }}
              onClose={() => setSeletor(null)}
            />
          ) : null}

          {erroReacao ? (
            <p className="mt-1 text-[11px] text-signal-dnd">{erroReacao}</p>
          ) : null}

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
