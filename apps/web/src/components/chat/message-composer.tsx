"use client";

import { useEffect, useRef, useState } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import type { PublicUser } from "@aether/shared";
import {
  useConnectionStatus,
  useRealtimeStore,
} from "@/lib/stores/realtime-store";
import { useSocket } from "@/components/realtime/realtime-provider";
import { cn } from "@/lib/utils";
import { MediaPicker } from "@/components/chat/media-picker";
import type { GifEscolhido } from "@/components/chat/gif-picker";
import {
  AnexosPendentes,
  ehImagem,
  type AnexoPendente,
} from "@/components/chat/anexos-pendentes";
import { enviarAnexo } from "@/lib/anexos/enviar";

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

/** O mesmo teto que o gateway aplica. Duas contas diferentes divergiriam. */
const MAX_ANEXOS = 10;

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
  const [seletor, setSeletor] = useState<{
    x: number;
    y: number;
    aba: "emoji" | "gif";
  } | null>(null);
  /** Onde o cursor deve ficar depois que o React aplicar o texto novo. */
  const [cursorPendente, setCursorPendente] = useState<number | null>(null);

  useEffect(() => {
    if (cursorPendente === null) return;
    const campo = textareaRef.current;
    if (campo) {
      campo.focus();
      campo.setSelectionRange(cursorPendente, cursorPendente);
      campo.style.height = "auto";
      campo.style.height = `${Math.min(campo.scrollHeight, 180)}px`;
    }
    setCursorPendente(null);
  }, [cursorPendente]);

  const disabled = !canSend || !connected;
  const tooLong = value.length > MAX_LENGTH;

  const [anexos, setAnexos] = useState<AnexoPendente[]>([]);
  const inputArquivoRef = useRef<HTMLInputElement>(null);
  /** Nenhum anexo pode estar subindo na hora de enviar. */
  const subindo = anexos.some((a) => a.estado === "enviando");
  const prontos = anexos.filter((a) => a.estado === "pronto" && a.id);

  function removerAnexo(chaveLocal: string) {
    setAnexos((atuais) => {
      const alvo = atuais.find((a) => a.chaveLocal === chaveLocal);
      // A previa e um `blob:` que segura memoria ate ser revogado.
      if (alvo?.previa) URL.revokeObjectURL(alvo.previa);
      return atuais.filter((a) => a.chaveLocal !== chaveLocal);
    });
  }

  async function escolherArquivos(lista: FileList | null) {
    if (!lista || lista.length === 0) return;
    const arquivos = Array.from(lista).slice(0, MAX_ANEXOS - anexos.length);

    for (const arquivo of arquivos) {
      const chaveLocal =
        globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${arquivo.name}`;

      setAnexos((atuais) => [
        ...atuais,
        {
          chaveLocal,
          id: null,
          nome: arquivo.name,
          tamanho: arquivo.size,
          mime: arquivo.type || "application/octet-stream",
          estado: "enviando",
          progresso: 0,
          previa: ehImagem(arquivo.type)
            ? URL.createObjectURL(arquivo)
            : undefined,
        },
      ]);

      /**
       * O envio comeca NA HORA DE ESCOLHER, e nao ao apertar enviar.
       *
       * Assim o arquivo grande sobe enquanto a pessoa escreve o texto, em vez
       * de ela clicar em enviar e esperar olhando. E o mesmo motivo de o botao
       * de enviar ficar bloqueado enquanto algo sobe: a mensagem so pode sair
       * com anexo que ja chegou.
       */
      void (async () => {
        try {
          const pronto = await enviarAnexo(arquivo, {
            onProgresso: (fracao) =>
              setAnexos((atuais) =>
                atuais.map((a) =>
                  a.chaveLocal === chaveLocal ? { ...a, progresso: fracao } : a,
                ),
              ),
          });
          setAnexos((atuais) =>
            atuais.map((a) =>
              a.chaveLocal === chaveLocal
                ? { ...a, id: pronto.id, estado: "pronto", progresso: 1 }
                : a,
            ),
          );
        } catch (erro) {
          setAnexos((atuais) =>
            atuais.map((a) =>
              a.chaveLocal === chaveLocal
                ? {
                    ...a,
                    estado: "erro",
                    erro: erro instanceof Error ? erro.message : "falhou",
                  }
                : a,
            ),
          );
        }
      })();
    }
  }

  function send() {
    const content = value.trim();
    // Com anexo pronto, mensagem sem texto e legitima — mandar so uma imagem
    // e o caso comum. O gateway aplica a mesma regra.
    if ((!content && prontos.length === 0) || tooLong || disabled || !socket) {
      return;
    }
    if (subindo) return;

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
      // Mensagem que ainda nao existe no banco nao tem reacao.
      reactions: [],
      /**
       * A mensagem otimista ja mostra os anexos, com a URL local da previa
       * quando e imagem. Sem isso a imagem sumiria entre o envio e a
       * confirmacao do gateway, e voltaria depois — um piscar que parece erro.
       */
      anexos: prontos.map((a) => ({
        id: a.id!,
        nome: a.nome,
        mime: a.mime,
        tamanho: a.tamanho,
        url: a.previa ?? "",
        largura: null,
        altura: null,
      })),
      pending: true,
      nonce,
    });

    const anexoIds = prontos.map((a) => a.id!);

    setValue("");
    resetHeight();
    setAnexos([]);

    socket.emit(
      "message:send",
      { conversationId: channelId, content, nonce, anexoIds },
      (result) => {
        // O sucesso chega pelo evento message:new (que tambem atende as outras
        // abas); aqui so tratamos a falha.
        if (!result.ok) failPending(channelId, nonce, result.error);
      },
    );
  }

  /**
   * GIF vai como uma mensagem cujo `content` E a URL direta do .gif/.mp4 do
   * Tenor. O `<MessageItem>` reconhece essa URL sozinha e desenha a midia em
   * vez do texto. Sem passar por anexo: nao e arquivo nosso no R2, e um embed
   * de link. Mesma via otimista do texto.
   */
  function enviarGif(gif: GifEscolhido) {
    if (disabled || !socket) return;
    const nonce =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    addPending({
      id: nonce,
      conversationId: channelId,
      content: gif.url,
      author: selfUser,
      createdAt: new Date().toISOString(),
      editedAt: null,
      reactions: [],
      anexos: [],
      pending: true,
      nonce,
    });

    socket.emit(
      "message:send",
      { conversationId: channelId, content: gif.url, nonce, anexoIds: [] },
      (result) => {
        if (!result.ok) failPending(channelId, nonce, result.error);
      },
    );
  }

  /**
   * Insere o emoji NO CURSOR, e nao no fim.
   *
   * Quem esta editando no meio da frase espera o emoji onde o cursor esta —
   * jogar no fim obrigaria a recortar e colar. `selectionStart/End` tambem
   * cobrem o caso de haver texto SELECIONADO: ali o emoji substitui a selecao,
   * que e o que qualquer editor faz.
   *
   * O cursor volta para DEPOIS do emoji e o foco volta para o campo: o seletor
   * fecha e a pessoa continua digitando sem precisar clicar de novo.
   */
  function inserirEmoji(emoji: string) {
    const campo = textareaRef.current;
    if (!campo) {
      setValue((atual) => atual + emoji);
      return;
    }
    const inicio = campo.selectionStart ?? campo.value.length;
    const fim = campo.selectionEnd ?? inicio;
    const novo = campo.value.slice(0, inicio) + emoji + campo.value.slice(fim);
    setValue(novo);

    /**
     * O cursor e reposicionado num EFEITO, e nao aqui.
     *
     * Primeira versao usava `requestAnimationFrame`, e o cursor ia parar no
     * FIM do texto — medido: inserir num "bom |dia" deixava o cursor na
     * posicao 9 em vez de 6. O motivo e que o rAF corre antes de o React
     * comitar o valor novo, e o proprio commit do campo controlado empurra o
     * cursor para o fim depois. Um efeito roda DEPOIS do commit, entao a
     * ultima palavra sobre o cursor e nossa.
     */
    setCursorPendente(inicio + emoji.length);
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
      {/*
        O seletor de arquivo fica ESCONDIDO e e acionado pelo clipe: o
        `<input type=file>` nativo nao tem como ser estilizado, e um botao
        proprio disparando o clique dele e o caminho padrao.
      */}
      <input
        ref={inputArquivoRef}
        type="file"
        multiple
        className="hidden"
        onChange={(evento) => {
          void escolherArquivos(evento.target.files);
          // Zerar o valor permite escolher O MESMO arquivo de novo depois de
          // remover; sem isso, o `change` nao dispara na segunda vez.
          evento.target.value = "";
        }}
      />

      <div
        className={cn(
          "flex flex-col rounded-lg border bg-base-900 transition-colors",
          tooLong
            ? "border-signal-dnd/50"
            : "border-line focus-within:border-line-strong",
          disabled && "opacity-60",
        )}
      >
        <AnexosPendentes anexos={anexos} onRemover={removerAnexo} />

        <div className="flex items-end gap-2 px-3 py-2">
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

          {/*
          Emoji e GIF ANTES do enviar: e a ordem em que se usam — escolhe o
          que acrescentar, depois manda. Os dois abrem o mesmo seletor
          (`MediaPicker`), so em abas diferentes.
        */}
          <button
            type="button"
            disabled={disabled}
            onClick={(evento) => {
              const r = evento.currentTarget.getBoundingClientRect();
              // Acima do botao: o campo fica no rodape, e abrir para baixo
              // jogaria o seletor para fora da janela.
              setSeletor({ x: r.right - 352, y: r.top - 452, aba: "gif" });
            }}
            aria-label="Enviar GIF"
            title="GIF"
            className="mb-[1px] grid h-7 shrink-0 place-items-center rounded-md px-1 text-[10px] font-bold tracking-tight text-ink-500 transition-colors hover:bg-base-800 hover:text-accent-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            GIF
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={(evento) => {
              const r = evento.currentTarget.getBoundingClientRect();
              setSeletor({ x: r.right - 352, y: r.top - 452, aba: "emoji" });
            }}
            aria-label="Inserir emoji"
            title="Emoji"
            className="mb-[1px] grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-500 transition-colors hover:bg-base-800 hover:text-accent-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <AetherIcon name="smile" className="h-4 w-4" />
          </button>

          {/*
          O clipe fica ao lado do emoji, e nao no comeco da linha: sao os dois
          botoes de "acrescentar algo a mensagem", e separa-los faria procurar
          em dois lugares.
        */}
          <button
            type="button"
            onClick={() => inputArquivoRef.current?.click()}
            disabled={disabled || anexos.length >= MAX_ANEXOS}
            title={
              anexos.length >= MAX_ANEXOS
                ? `Maximo de ${MAX_ANEXOS} arquivos por mensagem`
                : "Anexar arquivo"
            }
            aria-label="Anexar arquivo"
            className="mb-[1px] grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-500 transition-colors hover:bg-base-800 hover:text-ink-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-500"
          >
            <AetherIcon name="paperclip" className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={send}
            /**
             * Bloqueado enquanto algo SOBE: a mensagem so pode sair com anexo
             * que ja chegou ao R2 e foi confirmado. Deixar enviar antes faria o
             * gateway recusar a mensagem inteira, e a pessoa perderia o texto.
             */
            disabled={
              disabled ||
              tooLong ||
              subindo ||
              (value.trim().length === 0 && prontos.length === 0)
            }
            title={subindo ? "Aguarde o envio dos arquivos" : "Enviar"}
            aria-label="Enviar mensagem"
            className="mb-[1px] grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-500 transition-colors hover:bg-base-800 hover:text-accent-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-500"
          >
            <AetherIcon name="send" className="h-4 w-4" />
          </button>
        </div>
      </div>

      {seletor ? (
        <MediaPicker
          anchor={seletor}
          abaInicial={seletor.aba}
          /**
           * Emoji NAO fecha a cada escolha — escolher varios seguidos e o uso
           * comum. So funciona porque o seletor abre ACIMA do campo e nao o
           * cobre. GIF fecha ao escolher (envia na hora). Sai clicando fora ou
           * com Esc.
           */
          onEmoji={inserirEmoji}
          onGif={enviarGif}
          onClose={() => setSeletor(null)}
        />
      ) : null}

      {tooLong ? (
        <p className="mt-1.5 px-1 text-[11px] text-signal-dnd">
          {value.length} / {MAX_LENGTH} caracteres
        </p>
      ) : null}
    </div>
  );
}
