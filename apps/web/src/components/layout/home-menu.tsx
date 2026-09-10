"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AetherIcon, type AetherIconName } from "@/components/ui/aether-icon";
import {
  rotuloDeRevisoes,
  totalDeRevisoes,
  type RevisoesPendentes,
} from "@aether/shared";
import { contarRevisoesAction } from "@/server/actions/revisao";
import {
  useDmParaAbrir,
  useTotalDmNaoLido,
} from "@/lib/stores/realtime-store";
import { cn } from "@/lib/utils";

/**
 * O botao-marca no topo do trilho — a "home" do app.
 *
 * Substituiu os quatro icones soltos que viviam aqui (Amigos, Grupos, Olimpo,
 * Explorar) mais o painel da equipe. Agora e uma marca so; clicar abre um menu
 * a direita com todos esses lugares. O trilho fica com marca + servidores +
 * voce, e nada mais.
 *
 * O ponto de aviso na marca resume o que os badges individuais diziam: pedido
 * de amizade esperando decisao, ou conversa com mensagem nova. Sem ele, sumir
 * os icones sumiria tambem o sinal de "alguem precisa de voce".
 */

interface ItemDeMenu {
  href: string;
  label: string;
  icone: AetherIconName;
  /** classe extra do icone, para o dourado do Olimpo e o vermelho da equipe */
  tomIcone?: string;
  badge?: string | null;
}

export function HomeMenu({
  pendingRequests = 0,
  equipe = false,
}: {
  pendingRequests?: number;
  equipe?: boolean;
}) {
  const botaoRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [revisoes, setRevisoes] = useState<RevisoesPendentes | null>(null);

  const pathname = usePathname();
  const dmNaoLidas = useTotalDmNaoLido();
  const dmParaAbrir = useDmParaAbrir();
  const esperandoRevisao = totalDeRevisoes(revisoes);

  const temAviso = pendingRequests > 0 || dmNaoLidas > 0;

  /** As rotas que "pertencem" a home — a marca acende quando se esta numa. */
  const emHome =
    pathname === "/app" ||
    pathname === "/app/amigos" ||
    pathname === "/app/grupos" ||
    pathname === "/app/olimpo" ||
    pathname === "/app/explorar" ||
    pathname === "/app/loja" ||
    pathname === "/app/equipe" ||
    pathname.startsWith("/app/dm/");

  // A contagem de revisoes — so para a equipe, so ao abrir o menu.
  useEffect(() => {
    if (!aberto || !equipe) return;
    contarRevisoesAction()
      .then((r) => {
        if (r.ok) setRevisoes(r.data);
      })
      .catch(() => {});
  }, [aberto, equipe]);

  // Fecha ao navegar.
  useEffect(() => {
    setAberto(false);
  }, [pathname]);

  // Fecha no Esc.
  useEffect(() => {
    if (!aberto) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aberto]);

  useLayoutEffect(() => {
    if (!aberto) return;
    const btn = botaoRef.current?.getBoundingClientRect();
    if (!btn) return;
    const alt = menuRef.current?.offsetHeight ?? 320;
    const larg = menuRef.current?.offsetWidth ?? 232;
    setPos({
      left: Math.min(btn.right + 8, window.innerWidth - larg - 8),
      top: Math.max(8, Math.min(btn.top, window.innerHeight - alt - 8)),
    });
  }, [aberto]);

  const itens: ItemDeMenu[] = [
    {
      href: dmParaAbrir ? `/app/dm/${dmParaAbrir}` : "/app/amigos",
      label: "Amigos",
      icone: "users",
      badge:
        pendingRequests > 0
          ? `${pendingRequests > 9 ? "9+" : pendingRequests} pedido`
          : dmNaoLidas > 0
            ? `${dmNaoLidas > 9 ? "9+" : dmNaoLidas} nova`
            : null,
    },
    { href: "/app/loja", label: "Loja", icone: "sparkle" },
    { href: "/app/grupos", label: "Grupos", icone: "gamepad" },
    {
      href: "/app/olimpo",
      label: "Olimpo",
      icone: "crown",
      tomIcone: "text-amber-300",
    },
    { href: "/app/explorar", label: "Explorar comunidades", icone: "compass" },
  ];

  const itemEquipe: ItemDeMenu | null = equipe
    ? {
        href: "/app/equipe",
        label: "Painel da equipe",
        icone: "shield",
        tomIcone: "text-signal-dnd",
        badge:
          esperandoRevisao > 0 ? rotuloDeRevisoes(esperandoRevisao) : null,
      }
    : null;

  return (
    <>
      <button
        ref={botaoRef}
        type="button"
        onClick={() => setAberto((v) => !v)}
        title="AETHER — Amigos, Loja e mais"
        aria-label="Menu do AETHER"
        aria-expanded={aberto}
        className={cn(
          "group relative grid h-12 w-12 shrink-0 place-items-center bg-accent-500 text-white transition-all duration-150",
          aberto || emHome ? "rounded-[18px]" : "rounded-[24px] hover:rounded-[18px]",
        )}
      >
        <span
          className={cn(
            "absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-ink-100 transition-all duration-200",
            aberto || emHome ? "h-7" : temAviso ? "h-3.5" : "h-0 group-hover:h-3.5",
          )}
          style={{ left: "-10px" }}
        />
        <Image
          src="/marca-branca.png"
          alt=""
          width={26}
          height={26}
          className="pointer-events-none"
          priority
        />
        {temAviso && !aberto ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-signal-dnd ring-2 ring-base-900"
          />
        ) : null}
      </button>

      {aberto && typeof document !== "undefined"
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="Fechar menu"
                onClick={() => setAberto(false)}
                className="fixed inset-0 z-[70] cursor-default"
              />
              <div
                ref={menuRef}
                role="menu"
                style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
                className="fixed z-[71] w-[232px] animate-rise overflow-hidden rounded-xl border border-line bg-base-900 p-1.5 shadow-[var(--shadow-pop)]"
              >
                <p className="px-2.5 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-500">
                  AETHER
                </p>
                {itens.map((it) => (
                  <LinhaDeMenu
                    key={it.href}
                    item={it}
                    ativo={pathname === it.href}
                  />
                ))}
                {itemEquipe ? (
                  <>
                    <span className="my-1 block h-px bg-line-soft" />
                    <LinhaDeMenu
                      item={itemEquipe}
                      ativo={pathname === itemEquipe.href}
                    />
                  </>
                ) : null}
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}

function LinhaDeMenu({ item, ativo }: { item: ItemDeMenu; ativo: boolean }) {
  return (
    <Link
      href={item.href}
      role="menuitem"
      draggable={false}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors",
        ativo
          ? "bg-accent-500/12 text-ink-100"
          : "text-ink-300 hover:bg-base-800 hover:text-ink-100",
      )}
    >
      <AetherIcon
        name={item.icone}
        className={cn("h-4 w-4 shrink-0", item.tomIcone)}
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge ? (
        <span className="shrink-0 rounded-full bg-signal-dnd/15 px-1.5 text-[10px] font-semibold leading-[16px] text-signal-dnd">
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}
