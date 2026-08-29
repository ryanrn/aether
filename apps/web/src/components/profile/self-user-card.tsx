"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Settings, Volume2 } from "lucide-react";
import type { PublicChannel, PublicUser, UserStatus } from "@aether/shared";
import { useSocket } from "@/components/realtime/realtime-provider";
import {
  useRealtimeStore,
  useSelfVoice,
} from "@/lib/stores/realtime-store";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Cartao do PROPRIO usuario, aberto pelo nome na HUD.
 *
 * Antes o nome abria direto as configuracoes — um clique que ia para uma tela
 * inteira quando o que se quer, na maioria das vezes, e olhar a call ou trocar
 * o status. As configuracoes continuam a um clique daqui.
 *
 * O que ele mostra vem da store, ao vivo: quem entra ou sai da call aparece e
 * some sem fechar o cartao.
 */

export interface SelfCardAnchor {
  x: number;
  y: number;
}

const CARD_WIDTH = 260;
const EDGE_GAP = 8;

/**
 * OFFLINE aparece como "Invisivel": e o que ele significa para quem escolhe.
 * Dizer "offline" para alguem que esta claramente online seria mentira de
 * rotulo — quem clica quer sumir da lista, nao se desconectar.
 */
const OPCOES: { status: UserStatus; label: string; hint: string; cor: string }[] = [
  { status: "ONLINE", label: "Disponivel", hint: "", cor: "bg-signal-online" },
  { status: "IDLE", label: "Ausente", hint: "", cor: "bg-signal-idle" },
  { status: "DND", label: "Nao perturbe", hint: "", cor: "bg-signal-dnd" },
  {
    status: "OFFLINE",
    label: "Invisivel",
    hint: "Voce continua conectado, mas aparece apagado",
    cor: "bg-ink-500",
  },
];

export function SelfUserCard({
  user,
  voiceChannels,
  anchor,
  onClose,
  onOpenSettings,
}: {
  user: PublicUser;
  /** para resolver o NOME do canal ocupado — a voz so carrega o id */
  voiceChannels: PublicChannel[];
  anchor: SelfCardAnchor;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const socket = useSocket();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(anchor);

  const presence = useRealtimeStore((state) => state.presence);
  const voice = useRealtimeStore((state) => state.voice);
  const selfVoice = useSelfVoice();

  const status = presence[user.id] ?? "ONLINE";
  const channel = selfVoice?.channelId
    ? (voiceChannels.find((item) => item.id === selfVoice.channelId) ?? null)
    : null;

  /** Quem divide a call comigo — eu incluso, como no Discord. */
  const naCall = selfVoice?.channelId
    ? Object.values(voice).filter((p) => p.channelId === selfVoice.channelId)
    : [];

  /** Reposiciona depois de medir, para o cartao nunca sair da janela. */
  useLayoutEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition({
      x: Math.max(
        EDGE_GAP,
        Math.min(anchor.x, window.innerWidth - width - EDGE_GAP),
      ),
      y: Math.max(EDGE_GAP, Math.min(anchor.y, window.innerHeight - height - EDGE_GAP)),
    });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function escolher(novo: UserStatus) {
    socket?.emit("presence:set", novo);
    // Nao fechamos: ver a bolinha mudar confirma que pegou.
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="fixed inset-0 z-[60] cursor-default"
      />
      <div
        ref={cardRef}
        style={{ left: position.x, top: position.y, width: CARD_WIDTH }}
        className="fixed z-[61] animate-rise overflow-hidden rounded-lg border border-base-700 bg-base-800 shadow-[var(--shadow-pop)]"
      >
        <div className="h-12 bg-gradient-to-r from-accent-700/40 to-accent-500/20" />

        <div className="px-3.5 pb-3.5">
          <div className="-mt-6 mb-2.5">
            <Avatar
              userId={user.id}
              name={user.displayName}
              src={user.avatarUrl}
              moldura={user.moldura}
              status={status}
              size="lg"
            />
          </div>
          <p className="truncate text-[14px] font-semibold text-ink-100">
            {user.displayName}
          </p>
          <p className="select-text truncate font-mono text-[11px] text-ink-500">
            @{user.username}
          </p>

          {/*
            A call so aparece quando existe. Secao vazia com "nenhuma chamada"
            ocuparia espaco para dizer nada.
          */}
          {channel ? (
            <div className="mt-3 rounded-md border border-base-700 bg-base-900 p-2.5">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-500">
                em voz
              </p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Volume2 className="h-3.5 w-3.5 shrink-0 text-accent-400" />
                <span className="min-w-0 truncate text-[13px] font-medium text-ink-100">
                  {channel.name}
                </span>
              </div>

              {/*
                So os rostos, sobrepostos. Uma lista de nomes ocuparia a altura
                do cartao inteiro para dizer o que tres avatares dizem de
                relance — e o cartao e para olhar de relance.
              */}
              <div className="mt-2 flex items-center">
                {naCall.slice(0, 5).map((participante, indice) => (
                  <span
                    key={participante.userId}
                    title={participante.user.displayName}
                    className={cn(
                      "rounded-full ring-2 ring-base-900",
                      indice > 0 && "-ml-2",
                    )}
                  >
                    <Avatar
                      userId={participante.userId}
                      name={participante.user.displayName}
                      src={participante.user.avatarUrl}
                      moldura={participante.user.moldura}
                      size="xs"
                      speaking={
                        participante.speaking &&
                        !participante.selfMuted &&
                        !participante.serverMuted
                      }
                    />
                  </span>
                ))}
                {naCall.length > 5 ? (
                  <span className="-ml-2 grid h-6 w-6 place-items-center rounded-full bg-base-700 text-[10px] font-semibold text-ink-300 ring-2 ring-base-900">
                    +{naCall.length - 5}
                  </span>
                ) : null}
                <span className="ml-2 text-[11px] text-ink-500">
                  {naCall.length === 1 ? "so voce" : `${naCall.length} pessoas`}
                </span>
              </div>
            </div>
          ) : null}

          <div className="mt-3 border-t border-base-700 pt-2">
            {OPCOES.map((opcao) => {
              const ativo = status === opcao.status;
              return (
                <button
                  key={opcao.status}
                  type="button"
                  onClick={() => escolher(opcao.status)}
                  title={opcao.hint || undefined}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                    ativo ? "text-ink-100" : "text-ink-300 hover:bg-base-750",
                  )}
                >
                  <span
                    className={cn("h-2 w-2 shrink-0 rounded-full", opcao.cor)}
                    aria-hidden
                  />
                  <span className="flex-1">{opcao.label}</span>
                  {ativo ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-accent-400" />
                  ) : null}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenSettings();
            }}
            className="mt-2 flex w-full items-center gap-2.5 rounded-md border-t border-base-700 px-2 pb-1 pt-2.5 text-left text-[13px] text-ink-300 transition-colors hover:text-ink-100"
          >
            <Settings className="h-3.5 w-3.5 shrink-0" />
            Configuracoes
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
