"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { useConversasDm } from "@/lib/stores/realtime-store";
import { cn } from "@/lib/utils";

/**
 * Lista de conversas diretas, no rodape do painel de Amigos.
 *
 * Este era o espaco que `friends-nav` deixava reservado "para as mensagens
 * diretas, quando existirem". As conversas vem do store (`dm:list` na conexao +
 * cada DM que chega); as com mensagem nao lida sobem para o topo com um badge.
 *
 * No trilho estreito (<1024px) o painel de Amigos vira so icones — aqui a
 * lista some junto, porque avatar sem nome nao diz de quem e a conversa. O
 * badge no botao de Amigos do trilho principal cobre o aviso nesse caso.
 */
export function ConversasDm() {
  const conversas = useConversasDm();
  const params = useParams<{ dmId?: string }>();
  const ativa = params?.dmId;

  if (conversas.length === 0) return null;

  return (
    <div className="hidden min-h-0 flex-1 flex-col lg:flex">
      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
        Conversas
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {conversas.map(({ dmId, outro, naoLidas }) => (
          <Link
            key={dmId}
            href={`/app/dm/${dmId}`}
            className={cn(
              "flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 transition-colors",
              dmId === ativa
                ? "bg-accent-500/[0.12] text-accent-400"
                : "text-ink-300 hover:bg-base-850/60 hover:text-ink-100",
            )}
          >
            <Avatar
              userId={outro.id}
              name={outro.displayName}
              src={outro.avatarUrl}
              moldura={outro.moldura}
              status={outro.status}
              size="sm"
              round
              ring="border-base-900"
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px]",
                naoLidas > 0 && "font-semibold text-ink-100",
              )}
            >
              {outro.displayName}
            </span>
            {naoLidas > 0 ? (
              <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-signal-dnd px-1 text-[10px] font-bold leading-none text-white">
                {naoLidas > 9 ? "9+" : naoLidas}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
