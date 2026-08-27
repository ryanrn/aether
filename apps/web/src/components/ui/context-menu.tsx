"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Menu de clique direito.
 *
 * POR QUE EXISTE: no navegador, o botao direito abre o menu do NAVEGADOR —
 * "Recarregar", "Ver codigo fonte". Isso denuncia na hora que a coisa e uma
 * pagina, e nao um programa. Todo aplicativo de verdade responde ao botao
 * direito com o proprio menu.
 *
 * SO SUBSTITUIMOS ONDE TEMOS O QUE OFERECER. Bloquear o menu nativo no app
 * inteiro deixaria a pessoa sem "copiar" e sem nada no lugar — pior do que o
 * menu do navegador. Em texto e campo de digitacao o nativo continua.
 *
 * A MATEMATICA DE POSICAO mora aqui e nao em cada menu: perto da borda, um
 * menu ancorado no cursor sai da tela. `voice-member-menu.tsx` ja tinha
 * resolvido isso para o palco de voz; este arquivo e aquela solucao virada em
 * peca, para o proximo menu nao ser uma terceira copia da mesma conta.
 */

export interface PontoDoMenu {
  x: number;
  y: number;
}

/** Margem para o menu nunca encostar na borda da janela. */
const FOLGA = 8;

/**
 * Estado de um menu de contexto. `abrir` ja engole o menu do navegador.
 */
export function useMenuDeContexto() {
  const [ponto, setPonto] = useState<PontoDoMenu | null>(null);

  const abrir = useCallback((evento: React.MouseEvent) => {
    evento.preventDefault();
    /**
     * `stopPropagation` porque os alvos sao aninhados: a mensagem esta dentro
     * da lista, o canal dentro da categoria. Sem isto, um clique direito no
     * item de dentro abriria os dois menus.
     */
    evento.stopPropagation();
    setPonto({ x: evento.clientX, y: evento.clientY });
  }, []);

  const fechar = useCallback(() => setPonto(null), []);

  return { ponto, abrir, fechar };
}

export function ContextMenu({
  ponto,
  onClose,
  /** Cabecalho opcional: diz sobre O QUE e o menu quando o alvo nao e obvio. */
  titulo,
  largura = 210,
  children,
}: {
  ponto: PontoDoMenu | null;
  onClose: () => void;
  titulo?: string;
  largura?: number;
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [posicao, setPosicao] = useState<PontoDoMenu | null>(null);

  /**
   * Guarda quem tinha o foco ANTES de abrir para devolver no fim.
   *
   * Sem isso, clicar com o direito numa mensagem e apertar Esc deixaria o foco
   * no vazio: a pessoa voltaria a digitar e nao sairia nada, tendo de clicar
   * no campo de novo. Menu de programa devolve o foco de onde tirou.
   */
  const focoAnterior = useRef<HTMLElement | null>(null);

  /**
   * Mede o menu JA MONTADO e so entao decide onde ele fica.
   *
   * A ordem importa e ja errei aqui: enquanto o menu so entrava no documento
   * depois de a posicao existir, nao havia o que medir — a medicao caia num
   * atalho sem ajuste, e o menu aberto perto da borda ficava INTEIRO fora da
   * tela. Ele precisa nascer no ponto do cursor para ter tamanho.
   *
   * `useLayoutEffect` porque o acerto tem de acontecer antes da pintura; no
   * `useEffect` daria para ver o menu pular.
   */
  useLayoutEffect(() => {
    if (!ponto) {
      setPosicao(null);
      return;
    }
    const elemento = menuRef.current;
    if (!elemento) return;
    const { width, height } = elemento.getBoundingClientRect();
    setPosicao({
      x: Math.max(FOLGA, Math.min(ponto.x, window.innerWidth - width - FOLGA)),
      y: Math.max(FOLGA, Math.min(ponto.y, window.innerHeight - height - FOLGA)),
    });
  }, [ponto]);

  useEffect(() => {
    if (!ponto) return;
    focoAnterior.current = document.activeElement as HTMLElement | null;

    function naTecla(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        evento.preventDefault();
        onClose();
      }
    }
    /**
     * Rolar fecha o menu, como em qualquer programa: ele fica preso ao ponto
     * onde o cursor estava, e a lista por baixo andando deixaria o menu
     * apontando para outro item.
     */
    function aoRolar() {
      onClose();
    }

    document.addEventListener("keydown", naTecla);
    window.addEventListener("scroll", aoRolar, true);
    window.addEventListener("resize", aoRolar);
    return () => {
      document.removeEventListener("keydown", naTecla);
      window.removeEventListener("scroll", aoRolar, true);
      window.removeEventListener("resize", aoRolar);
      focoAnterior.current?.focus?.();
    };
  }, [ponto, onClose]);

  if (!ponto) return null;
  if (typeof document === "undefined") return null;

  // Antes de medir, o menu existe no ponto do cursor mas invisivel: e desse
  // render que sai a largura e a altura usadas para traze-lo para dentro.
  const lugar = posicao ?? ponto;

  return createPortal(
    <>
      {/*
        Fundo invisivel que captura o proximo clique. Clique direito nele
        FECHA em vez de abrir o menu do navegador — abrir o menu nativo por
        cima do nosso seria o pior dos dois mundos.
      */}
      <button
        type="button"
        aria-label="Fechar menu"
        onClick={onClose}
        onContextMenu={(evento) => {
          evento.preventDefault();
          onClose();
        }}
        className="fixed inset-0 z-[70] cursor-default"
      />
      <div
        ref={menuRef}
        role="menu"
        style={{
          left: lugar.x,
          top: lugar.y,
          width: largura,
          visibility: posicao ? undefined : "hidden",
        }}
        className="fixed z-[71] animate-rise rounded-lg border border-base-700 bg-base-900 p-1 shadow-pop"
      >
        {titulo ? (
          <p className="truncate px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
            {titulo}
          </p>
        ) : null}
        {children}
      </div>
    </>,
    document.body,
  );
}

export function ItemDoMenu({
  icone,
  onClick,
  danger = false,
  disabled = false,
  children,
}: {
  icone?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px]",
        "transition-colors",
        disabled
          ? "cursor-not-allowed text-ink-500 opacity-50"
          : danger
            ? "text-signal-dnd hover:bg-signal-dnd/12"
            : "text-ink-200 hover:bg-base-800 hover:text-ink-100",
      )}
    >
      {icone ? <span className="shrink-0">{icone}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function SeparadorDoMenu() {
  return <div className="my-1 h-px bg-base-800" />;
}
