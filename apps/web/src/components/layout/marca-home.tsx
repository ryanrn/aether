"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ehRotaHome } from "@/components/layout/home-nav-panel";
import { useTotalDmNaoLido } from "@/lib/stores/realtime-store";
import { cn } from "@/lib/utils";

/**
 * A marca no topo do trilho — o atalho para a "home" do app.
 *
 * Substituiu os cinco icones soltos que viviam aqui. Clicar leva para Amigos
 * (a home abre ali); o painel esquerdo (`HomeNavPanel`) e que traz o resto.
 *
 * O ponto de aviso resume o que os badges individuais diziam — pedido de
 * amizade esperando decisao, ou conversa com mensagem nova. Sem ele, sumir os
 * icones sumiria tambem o sinal de "alguem precisa de voce".
 */
export function MarcaHome({
  pendingRequests = 0,
}: {
  pendingRequests?: number;
}) {
  const pathname = usePathname();
  const dmNaoLidas = useTotalDmNaoLido();
  const ativo = ehRotaHome(pathname);
  const aviso = pendingRequests > 0 || dmNaoLidas > 0;

  return (
    <Link
      href="/app/amigos"
      title="AETHER — Amigos, Loja e mais"
      aria-label="Início do AETHER"
      aria-current={ativo ? "page" : undefined}
      draggable={false}
      className="group relative flex w-full justify-center"
    >
      <span
        className={cn(
          "absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-ink-100 transition-all duration-200",
          ativo ? "h-7" : aviso ? "h-3.5" : "h-0 group-hover:h-3.5",
        )}
      />
      <span
        className={cn(
          "relative grid h-12 w-12 place-items-center bg-accent-500 text-white transition-all duration-150",
          ativo ? "rounded-[18px]" : "rounded-[24px] group-hover:rounded-[18px]",
        )}
      >
        <Image
          src="/marca-branca.png"
          alt=""
          width={26}
          height={26}
          className="pointer-events-none"
          priority
        />
        {aviso && !ativo ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-signal-dnd ring-2 ring-base-900"
          />
        ) : null}
      </span>
    </Link>
  );
}
