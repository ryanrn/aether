"use client";

import { useRef, useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import { AnexosDaMensagem } from "@/components/chat/anexos-pendentes";
import { DenunciarDialog } from "@/components/chat/denunciar-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useSocket } from "@/components/realtime/realtime-provider";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import {
  ContextMenu,
  ItemDoMenu,
  useMenuDeContexto,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { copiarTexto } from "@/lib/clipboard";
import { Emoji } from "@/components/ui/emoji";
import { quebrarEmEmoji } from "@/lib/emoji/twemoji";
import { ehMidiaEmbutivel, MidiaEmbutida } from "@/components/chat/midia-embutida";
import { TextoDeMensagem } from "@/components/chat/texto-de-mensagem";
import { EditorDeMensagem } from "@/components/chat/editor-de-mensagem";
import type { ChatMessage } from "@/lib/stores/realtime-store";

/**
 * Uma LINHA de mensagem — dentro de um `<MessageGroup>`, que ja desenhou o
 * avatar, o nome e o horario do grupo. Aqui fica so o que muda de mensagem
 * para mensagem: o texto, os anexos, as reacoes e as acoes de hover.
 *
 * `primeira` = primeira do grupo: nao repete o horario na sarjeta (o cabecalho
 * do grupo ja mostra).
 *
 * O conteudo entra como texto puro. Sem `dangerouslySetInnerHTML` — o React
 * escapa, entao HTML ou script colado numa mensagem aparece como texto.
 */
export function MessageItem({
  message,
  primeira,
  onResponder,
  onIrParaMensagem,
}: {
  message: ChatMessage;
  primeira: boolean;
  onResponder?: (message: ChatMessage) => void;
  onIrParaMensagem?: (id: string) => void;
}) {
  const time = new Date(message.createdAt);
  const socket = useSocket();
  const selfUserId = useRealtimeStore((s) => s.selfUserId);
  const retrySending = useRealtimeStore((s) => s.retrySending);
  const failPending = useRealtimeStore((s) => s.failPending);
  const removerMensagemLocal = useRealtimeStore((s) => s.removerMensagem);
  const [seletor, setSeletor] = useState<{ x: number; y: number } | null>(null);
  const [denunciarAberto, setDenunciarAberto] = useState(false);
  const [erroReacao, setErroReacao] = useState<string | null>(null);
  const [excluirAberto, setExcluirAberto] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);

  const menu = useMenuDeContexto();
  const linhaRef = useRef<HTMLDivElement | null>(null);
  /**
   * O que "Copiar" vai copiar, decidido no instante em que o menu abre. Com
   * texto selecionado, a selecao; sem, a mensagem inteira. Fica em estado
   * porque clicar no menu desfaz a selecao.
   */
  const [selecao, setSelecao] = useState<string | null>(null);

  function abrirMenu(evento: React.MouseEvent) {
    const marcado = window.getSelection();
    const texto = marcado?.toString() ?? "";
    const daquiDeDentro =
      texto.trim().length > 0 &&
      marcado?.anchorNode != null &&
      linhaRef.current?.contains(marcado.anchorNode) === true;
    setSelecao(daquiDeDentro ? texto : null);
    menu.abrir(evento);
  }

  /**
   * Alterna a reacao. O servidor decide ligar/desligar — o cliente so diz
   * "este emoji, nesta mensagem". Sem estado otimista: a verdade chega inteira
   * pelo `reaction:update`.
   */
  function alternar(emoji: string) {
    setErroReacao(null);
    socket?.emit(
      "reaction:toggle",
      { messageId: message.id, emoji },
      (resultado) => {
        if (!resultado.ok) setErroReacao(resultado.error);
      },
    );
  }

  // Mensagem que ainda nao existe no banco nao pode receber reacao.
  const podeReagir = socket !== null && !message.pending && !message.failed;
  const midiaUrl = ehMidiaEmbutivel(message.content);
  const jumbo = !midiaUrl && ehSoEmoji(message.content);
  const podeDenunciar =
    !message.pending && !message.failed && message.author.id !== selfUserId;
  /**
   * So a PROPRIA mensagem, por enquanto. O gateway (`apagarMensagem`) ja aceita
   * MANAGE_MESSAGES para apagar a de outro tambem — falta so este componente
   * saber se o cargo de quem olha tem essa permissao NESTE canal, o que ainda
   * nao chega como prop ate aqui.
   */
  const podeExcluir =
    socket !== null &&
    !message.pending &&
    !message.failed &&
    message.author.id === selfUserId;

  /** Editar e so do autor — o gateway confere de novo, isto so esconde o item. */
  const podeEditar = podeExcluir;

  function excluirMensagem() {
    if (!socket) return;
    setExcluindo(true);
    setErroExclusao(null);
    socket.emit("message:delete", { messageId: message.id }, (resultado) => {
      setExcluindo(false);
      if (resultado.ok) {
        setExcluirAberto(false);
        // A propria mensagem some da tela via "message:deleted" no store —
        // nao precisa fazer nada aqui alem de fechar o dialogo.
        return;
      }
      setErroExclusao(resultado.error);
    });
  }

  /**
   * Reenvia uma mensagem que falhou, com o MESMO nonce — assim, se desta vez
   * der certo, `message:new` reconcilia com esta mesma linha otimista em vez
   * de duplicar. Tudo que precisa ja esta guardado na propria mensagem
   * (conteudo, anexos ja enviados, resposta) — nao precisa reescrever nada.
   */
  function reenviar() {
    if (!socket || !message.nonce) return;
    retrySending(message.conversationId, message.nonce);
    socket.emit(
      "message:send",
      {
        conversationId: message.conversationId,
        content: message.content,
        nonce: message.nonce,
        anexoIds: message.anexos.map((a) => a.id),
        replyToId: message.replyTo?.id,
      },
      (resultado) => {
        if (!resultado.ok) {
          failPending(message.conversationId, message.nonce!, resultado.error);
        }
      },
    );
  }

  return (
    <div
      ref={linhaRef}
      data-mid={message.id}
      onContextMenu={abrirMenu}
      style={{
        paddingTop: "var(--chat-row-py)",
        paddingBottom: "var(--chat-row-py)",
      }}
      className={cn(
        "chat-msg group/msg relative rounded-md px-2 transition-colors hover:bg-base-900/45",
        message.pending && "opacity-55",
      )}
    >
      {message.replyTo ? (
        <ReferenciaDeResposta
          reply={message.replyTo}
          onIr={() => onIrParaMensagem?.(message.replyTo!.id)}
        />
      ) : null}

      {/* horario na sarjeta do avatar (hover) — a primeira ja tem no cabecalho */}
      {!primeira ? (
        <time
          dateTime={message.createdAt}
          suppressHydrationWarning
          className="chat-msg__hora pointer-events-none absolute top-[0.2rem] hidden w-[42px] pr-1 text-right font-mono text-[10px] leading-4 text-ink-600 group-hover/msg:block"
          style={{ left: "calc(-1 * var(--chat-gutter) + 4px)" }}
        >
          {formatarHora(time)}
        </time>
      ) : null}

      {/*
        Acoes rapidas — flutuam no canto, ancoradas por `absolute` para nao
        empurrar a altura da mensagem quando o socket conecta: reagir · responder
        · mais (o mesmo menu do botao direito).
      */}
      {podeReagir ? (
        <div
          className={cn(
            "absolute -top-3.5 right-2 z-10 flex items-center overflow-hidden rounded-lg",
            "border border-line bg-base-800/95 shadow-sm backdrop-blur-sm",
            "opacity-0 transition-opacity duration-150",
            "group-hover/msg:opacity-100 focus-within:opacity-100",
          )}
        >
          <button
            type="button"
            onClick={(evento) => {
              const r = evento.currentTarget.getBoundingClientRect();
              setSeletor({ x: r.left - 340, y: r.bottom + 6 });
            }}
            title="Reagir"
            aria-label="Reagir a esta mensagem"
            className="grid h-7 w-7 place-items-center text-ink-400 transition-colors hover:bg-base-750 hover:text-accent-300"
          >
            <AetherIcon name="smile" className="h-4 w-4" strokeWidth={1.75} />
          </button>
          {onResponder ? (
            <button
              type="button"
              onClick={() => onResponder(message)}
              title="Responder"
              aria-label="Responder a esta mensagem"
              className="grid h-7 w-7 place-items-center border-l border-line text-ink-400 transition-colors hover:bg-base-750 hover:text-accent-300"
            >
              <AetherIcon name="reply" className="h-4 w-4" strokeWidth={1.75} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={(evento) => {
              evento.preventDefault();
              menu.abrir(evento);
            }}
            title="Mais"
            aria-label="Mais acoes"
            className="grid h-7 w-7 place-items-center border-l border-line text-ink-400 transition-colors hover:bg-base-750 hover:text-ink-100"
          >
            <AetherIcon name="more" className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      ) : null}

      {/*
        `select-text` porque a interface inteira nasce nao selecionavel. O corpo
        da mensagem e o texto que mais se le no app — dai `ink-200`, e nao o tom
        de coisa secundaria.
      */}
      {editando ? (
        <EditorDeMensagem message={message} onFechar={() => setEditando(false)} />
      ) : midiaUrl ? (
        <MidiaEmbutida url={midiaUrl} />
      ) : (
        <p
          className={cn(
            "chat-msg__texto select-text whitespace-pre-wrap break-words text-ink-200",
            jumbo && "chat-msg__texto--jumbo leading-none",
          )}
        >
          <TextoDeMensagem texto={message.content} />
          {message.editedAt ? (
            <span
              title={`Editada em ${new Date(message.editedAt).toLocaleString()}`}
              className="ml-1 select-none align-baseline text-[10px] text-ink-500"
            >
              (editada)
            </span>
          ) : null}
        </p>
      )}

      <AnexosDaMensagem anexos={message.anexos ?? []} />

      {/* A fileira de reacoes SO existe quando ha reacao — invisivel ainda ocupa altura. */}
      {message.reactions.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {message.reactions.map((reacao) => (
            <button
              key={reacao.emoji}
              type="button"
              disabled={!podeReagir}
              onClick={() => alternar(reacao.emoji)}
              title={reacao.mine ? "Tirar sua reacao" : "Reagir tambem"}
              className={cn(
                "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] leading-none",
                "transition-colors duration-150 disabled:cursor-not-allowed",
                reacao.mine
                  ? "bg-accent-500/18 text-accent-200 ring-1 ring-inset ring-accent-500/40"
                  : "bg-base-800/70 text-ink-300 hover:bg-base-750",
              )}
            >
              <Emoji char={reacao.emoji} className="!h-4 !w-4" />
              <span className="font-mono tabular-nums">{reacao.count}</span>
            </button>
          ))}
          {podeReagir ? (
            <button
              type="button"
              onClick={(evento) => {
                const r = evento.currentTarget.getBoundingClientRect();
                setSeletor({ x: r.left - 320, y: r.bottom + 6 });
              }}
              title="Adicionar reacao"
              aria-label="Adicionar reacao"
              className="grid h-[22px] w-[22px] place-items-center rounded-md text-ink-500 opacity-0 transition-all duration-150 hover:bg-base-750 hover:text-ink-200 group-hover/msg:opacity-100"
            >
              <AetherIcon name="smile" className="h-3.5 w-3.5" />
            </button>
          ) : null}
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
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-signal-dnd">
          <AetherIcon name="alert" className="h-3 w-3 shrink-0" />
          {message.failed}
          <button
            type="button"
            onClick={reenviar}
            className="font-medium underline decoration-dotted underline-offset-2 hover:text-signal-dnd/80"
          >
            Tentar de novo
          </button>
          <span className="text-ink-500">·</span>
          <button
            type="button"
            onClick={() => removerMensagemLocal(message.id)}
            className="text-ink-500 underline decoration-dotted underline-offset-2 hover:text-ink-300"
          >
            Descartar
          </button>
        </p>
      ) : null}

      <ContextMenu ponto={menu.ponto} onClose={menu.fechar}>
        <ItemDoMenu
          icone={<AetherIcon name="copy" className="h-3.5 w-3.5" />}
          onClick={() => {
            void copiarTexto(selecao ?? message.content);
            menu.fechar();
          }}
        >
          {selecao ? "Copiar selecao" : "Copiar texto"}
        </ItemDoMenu>

        {onResponder && !message.pending && !message.failed ? (
          <ItemDoMenu
            icone={<AetherIcon name="reply" className="h-3.5 w-3.5" />}
            onClick={() => {
              menu.fechar();
              onResponder(message);
            }}
          >
            Responder
          </ItemDoMenu>
        ) : null}

        <ItemDoMenu
          icone={<AetherIcon name="smile" className="h-3.5 w-3.5" />}
          disabled={!podeReagir}
          onClick={() => {
            const ponto = menu.ponto;
            menu.fechar();
            if (ponto) setSeletor({ x: ponto.x - 340, y: ponto.y + 6 });
          }}
        >
          Reagir
        </ItemDoMenu>

        {podeEditar ? (
          <ItemDoMenu
            icone={<AetherIcon name="pencil" className="h-3.5 w-3.5" />}
            onClick={() => {
              menu.fechar();
              setEditando(true);
            }}
          >
            Editar mensagem
          </ItemDoMenu>
        ) : null}

        {podeDenunciar ? (
          <ItemDoMenu
            icone={<AetherIcon name="shield" className="h-3.5 w-3.5" />}
            onClick={() => {
              menu.fechar();
              setDenunciarAberto(true);
            }}
          >
            Denunciar
          </ItemDoMenu>
        ) : null}

        {podeExcluir ? (
          <ItemDoMenu
            icone={<AetherIcon name="trash" className="h-3.5 w-3.5" />}
            danger
            onClick={() => {
              menu.fechar();
              setErroExclusao(null);
              setExcluirAberto(true);
            }}
          >
            Excluir mensagem
          </ItemDoMenu>
        ) : null}
      </ContextMenu>

      <DenunciarDialog
        open={denunciarAberto}
        onClose={() => setDenunciarAberto(false)}
        tipo="MENSAGEM"
        alvoId={message.id}
        oQue={`mensagem de ${message.author.displayName}`}
      />

      <ConfirmDialog
        open={excluirAberto}
        onClose={() => (excluindo ? undefined : setExcluirAberto(false))}
        title="Excluir mensagem"
        confirmLabel="Excluir"
        pending={excluindo}
        onConfirm={excluirMensagem}
      >
        Esta mensagem some para todo mundo no canal. Essa acao nao pode ser
        desfeita.
        {erroExclusao ? (
          <span className="mt-2 block text-signal-dnd">{erroExclusao}</span>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

/**
 * A referencia curta a mensagem respondida, acima do conteudo. Clicar rola ate
 * a original e a pisca. Se a original foi apagada, vira "mensagem apagada".
 */
function ReferenciaDeResposta({
  reply,
  onIr,
}: {
  reply: NonNullable<ChatMessage["replyTo"]>;
  onIr: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onIr}
      className="group/ref mb-0.5 flex max-w-full items-center gap-1.5 text-[11.5px] text-ink-500 transition-colors hover:text-ink-300"
    >
      <span
        aria-hidden
        className="ml-1 h-2 w-3.5 shrink-0 rounded-tl-md border-l border-t border-line-strong"
      />
      <AetherIcon name="reply" className="h-3 w-3 shrink-0 -scale-x-100" />
      <span className="shrink-0 font-medium text-ink-400 group-hover/ref:text-ink-200">
        {reply.autorNome}
      </span>
      <span className="truncate">
        {reply.apagada ? (
          <span className="italic text-ink-600">mensagem apagada</span>
        ) : reply.trecho ? (
          reply.trecho
        ) : (
          <span className="italic">anexo</span>
        )}
      </span>
    </button>
  );
}

/**
 * Formatacao no fuso de quem le. No servidor o fuso e outro — dai o
 * `suppressHydrationWarning`: a diferenca e esperada e some na hidratacao.
 */
function formatarHora(date: Date): string {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** So emoji (ate 8) e espaco — ai o chat desenha os emojis grandes. */
function ehSoEmoji(texto: string): boolean {
  const t = texto.trim();
  if (!t) return false;
  const pedacos = quebrarEmEmoji(t);
  let emojis = 0;
  for (const p of pedacos) {
    if (p.tipo === "emoji") emojis++;
    else if (p.valor.trim().length > 0) return false;
  }
  return emojis > 0 && emojis <= 8;
}
