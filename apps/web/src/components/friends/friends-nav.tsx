"use client";

import { Mail, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export type SecaoAmigos = "amigos" | "solicitacoes";

/**
 * Painel esquerdo da tela de amigos — 244px fixos.
 *
 * SO HA DOIS ITENS, e isso e deliberado. O desenho pedia tambem "Nitro",
 * "Loja", "Missoes" e uma secao de mensagens diretas; nada disso existe no
 * Aether. Construir a casca de um recurso inexistente entrega um botao que nao
 * faz nada — que e demonstracao visual, nao produto. Entram aqui conforme
 * passarem a existir.
 *
 * "Solicitacoes" e secao propria, e nao mais uma aba, porque e a unica coisa
 * desta tela que ESPERA UMA DECISAO sua. Empilhada junto dos amigos, um pedido
 * novo ficava embaixo de uma lista que pode ser longa.
 */
export function FriendsNav({
  secao,
  onSecao,
  pedidosRecebidos,
}: {
  secao: SecaoAmigos;
  onSecao: (secao: SecaoAmigos) => void;
  pedidosRecebidos: number;
}) {
  return (
    <nav
      aria-label="Amigos"
      /**
       * Abaixo de 1024px vira TRILHO DE ICONES, e nao some.
       *
       * Sumir custaria caro: e por aqui que se chega em "Solicitacoes", e nao
       * ha outro caminho ate ela. O trilho mantem os dois destinos alcancaveis
       * em 60px em vez de 244px — o rotulo e o cabecalho e que saem.
       */
      className="flex w-[60px] shrink-0 flex-col border-r border-white/[0.06] bg-base-900 lg:w-[244px]"
    >
      <header className="flex h-12 shrink-0 items-center px-4">
        <h2 className="hidden truncate text-[14px] font-bold uppercase tracking-[0.04em] text-ink-100 lg:block">
          Aether
        </h2>
      </header>

      <div className="flex flex-col gap-0.5 px-2">
        <ItemNav
          icone={Users}
          rotulo="Amigos"
          ativo={secao === "amigos"}
          onClick={() => onSecao("amigos")}
        />
        <ItemNav
          icone={Mail}
          rotulo="Solicitacoes"
          ativo={secao === "solicitacoes"}
          badge={pedidosRecebidos}
          onClick={() => onSecao("solicitacoes")}
        />
      </div>

      <div className="mx-3 my-2 h-px bg-white/[0.06]" />

      {/*
        O espaco que sobra e das mensagens diretas, quando elas existirem.
        Deixado vazio de proposito, em vez de preenchido com algo que nao
        funciona.
      */}
      <div className="flex-1" />
    </nav>
  );
}

function ItemNav({
  icone: Icone,
  rotulo,
  ativo,
  badge = 0,
  onClick,
}: {
  icone: typeof Users;
  rotulo: string;
  ativo: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={rotulo}
      aria-label={rotulo}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-[6px] py-2.5 text-left text-[15px]",
        // No trilho o icone fica centrado; com rotulo, alinhado a esquerda.
        "justify-center px-0 lg:justify-start lg:px-3",
        "transition-colors duration-150",
        ativo
          ? "bg-accent-500/[0.12] text-accent-400"
          : "text-ink-300 hover:bg-white/[0.03] hover:text-ink-100",
      )}
    >
      {/*
        O `title` cobre o que o rotulo escondido deixaria de dizer no trilho.
        Sem ele, dois icones sem texto viram adivinhacao.
      */}
      <Icone
        className="h-[22px] w-[22px] shrink-0"
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="hidden min-w-0 flex-1 truncate font-medium lg:block">
        {rotulo}
      </span>
      {badge > 0 ? (
        <span className="shrink-0 rounded-lg bg-signal-dnd px-2 py-0.5 text-[11px] font-bold leading-4 text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </button>
  );
}
