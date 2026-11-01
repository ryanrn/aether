"use client";

import { useEffect, useRef, useState } from "react";
import { useSocket } from "@/components/realtime/realtime-provider";
import { useRealtimeStore } from "@/lib/stores/realtime-store";
import type { ChatMessage } from "@/lib/stores/realtime-store";

/** O mesmo teto do composer e do `messageContentSchema`. */
const MAX_LENGTH = 4000;

/** Quanto esperar a confirmacao do gateway antes de desistir. */
const ACK_MS = 8000;

/**
 * Edicao no lugar da propria mensagem: o texto vira um campo, Enter salva,
 * Shift+Enter quebra linha, Esc cancela.
 *
 * Quem decide se pode e o gateway (`editarMensagem`) — aqui so se mostra o
 * erro que ele devolve. A confirmacao aplica a edicao no store na hora, sem
 * esperar o `message:updated` da sala; quando o evento chega, o store ve o
 * mesmo `editedAt` e nao faz nada.
 */
export function EditorDeMensagem({
  message,
  onFechar,
}: {
  message: ChatMessage;
  onFechar: () => void;
}) {
  const socket = useSocket();
  const aplicarEdicao = useRealtimeStore((s) => s.aplicarEdicao);
  const [texto, setTexto] = useState(message.content);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campoRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const campo = campoRef.current;
    if (!campo) return;
    campo.focus();
    // Cursor no fim, como quem continua escrevendo.
    campo.setSelectionRange(campo.value.length, campo.value.length);
  }, []);

  // Altura acompanha o texto, ate um teto; dali rola.
  useEffect(() => {
    const campo = campoRef.current;
    if (!campo) return;
    campo.style.height = "auto";
    campo.style.height = `${Math.min(campo.scrollHeight, 320)}px`;
  }, [texto]);

  function salvar() {
    if (!socket || salvando) return;
    if (texto === message.content) {
      onFechar();
      return;
    }
    setSalvando(true);
    setErro(null);
    // Com prazo: um gateway que nao conhece `message:edit` (deploy fora de
    // ordem) nunca responde, e o campo ficaria "salvando" para sempre.
    socket.timeout(ACK_MS).emit(
      "message:edit",
      { messageId: message.id, content: texto },
      (semResposta, resultado) => {
        setSalvando(false);
        if (semResposta) {
          setErro("Sem resposta do servidor. Tente de novo em instantes.");
          return;
        }
        if (!resultado.ok) {
          setErro(resultado.error);
          return;
        }
        if (resultado.editedAt) {
          aplicarEdicao({
            messageId: message.id,
            conversationId: message.conversationId,
            content: resultado.content,
            editedAt: resultado.editedAt,
          });
        }
        onFechar();
      },
    );
  }

  return (
    <div className="mt-0.5">
      <textarea
        ref={campoRef}
        value={texto}
        maxLength={MAX_LENGTH}
        disabled={salvando}
        rows={1}
        aria-label="Editar mensagem"
        onChange={(evento) => setTexto(evento.target.value)}
        onKeyDown={(evento) => {
          if (evento.key === "Escape") {
            evento.preventDefault();
            onFechar();
          } else if (
            evento.key === "Enter" &&
            !evento.shiftKey &&
            !evento.nativeEvent.isComposing
          ) {
            evento.preventDefault();
            salvar();
          }
        }}
        className="w-full resize-none rounded-md border border-line bg-base-900 px-3 py-2 text-ink-100 outline-none focus:border-accent-500/60 disabled:opacity-60"
      />
      <p className="mt-1 text-[11px] text-ink-500">
        Esc para{" "}
        <button
          type="button"
          onClick={onFechar}
          className="text-accent-300 hover:underline"
        >
          cancelar
        </button>{" "}
        · Enter para{" "}
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          className="text-accent-300 hover:underline disabled:opacity-60"
        >
          salvar
        </button>
      </p>
      {erro ? <p className="mt-1 text-[11px] text-signal-dnd">{erro}</p> : null}
    </div>
  );
}
