"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Plus, Users } from "lucide-react";
import type { PublicServer } from "@aether/shared";
import { cn, colorFromId, initials } from "@/lib/utils";
import { CreateServerModal } from "@/components/servers/create-server-modal";
import { useShellStore } from "@/lib/stores/shell-store";
import { useUnreadByServer } from "@/lib/stores/realtime-store";

/**
 * Barra vertical de servidores. Estado ativo marcado por uma barra de acento
 * na borda esquerda (nao por preenchimento) para manter a interface calma.
 */
export function ServerRail({
  servers,
  pendingRequests = 0,
}: {
  servers: PublicServer[];
  /** pedidos de amizade esperando VOCE decidir — o ponto no botao de amigos */
  pendingRequests?: number;
}) {
  const params = useParams<{ serverId?: string }>();
  const activeId = params?.serverId;
  const pathname = usePathname();
  const emAmigos = pathname === "/app/amigos";
  const [modalOpen, setModalOpen] = useState(false);
  const naoLidas = useUnreadByServer();

  /**
   * Publica a lista para a barra de TITULO, que vive no layout raiz e nao tem
   * como buscar isso sozinha. Daqui sai de graca: a lista ja chega pronta do
   * servidor e este componente ja e de cliente.
   */
  const setServers = useShellStore((estado) => estado.setServers);
  useEffect(() => setServers(servers), [servers, setServers]);

  return (
    <>
      <nav
        aria-label="Servidores"
        className="flex w-16 shrink-0 flex-col items-center gap-3 border-r border-base-800 bg-base-900 py-3"
      >
        {/**
         * Amigos primeiro, e separado dos servidores por uma linha: nao e um
         * servidor, e ficar no meio deles sugeriria que fosse.
         */}
        <Link
          href="/app/amigos"
          title="Amigos"
          className="group relative flex w-full justify-center"
        >
          <span
            className={cn(
              "absolute left-0 top-1/2 h-0 w-[3px] -translate-y-1/2 rounded-r-full bg-ink-100 transition-all duration-200",
              emAmigos ? "h-7" : "group-hover:h-3.5",
            )}
          />
          <span
            className={cn(
              "grid h-11 w-11 place-items-center rounded-xl transition-all duration-150",
              emAmigos
                ? "bg-base-800 text-ink-100"
                : "bg-base-800 text-ink-300 group-hover:scale-105 group-hover:text-ink-100",
            )}
          >
            <Users className="h-5 w-5" />
          </span>
          {pendingRequests > 0 ? (
            <span
              aria-label={`${pendingRequests} pedido(s) de amizade`}
              className="absolute -right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-signal-dnd px-1 text-[10px] font-semibold text-ink-100"
              style={{ right: "0.6rem" }}
            >
              {pendingRequests > 9 ? "9+" : pendingRequests}
            </span>
          ) : null}
        </Link>

        <span className="h-px w-8 bg-base-700" />

        {servers.map((server) => {
          const active = server.id === activeId;
          const quantas = naoLidas[server.id] ?? 0;
          return (
            <Link
              key={server.id}
              href={`/app/s/${server.id}`}
              title={server.name}
              className="group relative flex w-full justify-center"
            >
              <span
                className={cn(
                  "absolute left-0 top-1/2 h-0 w-[3px] -translate-y-1/2 rounded-r-full bg-ink-100 transition-all duration-200",
                  active ? "h-7" : "group-hover:h-3.5",
                )}
              />
              {/*
                Caixa do TAMANHO DO ICONE, e nao do link.

                O link ocupa a largura inteira do trilho (64px) e o icone tem
                44px centrados. Ancorar a bolinha no link a jogava 12px alem da
                borda direita do icone — para fora do trilho, medido. Ela
                precisa do canto do ICONE, entao o icone e que tem de ser o
                ponto de referencia.
              */}
              <span className="relative">
              <span
                className={cn(
                  "grid h-11 w-11 place-items-center overflow-hidden rounded-xl text-[13px] font-semibold text-ink-100",
                  "transition-all duration-150",
                  active ? "bg-base-800" : "group-hover:scale-105",
                )}
                style={
                  server.iconUrl
                    ? undefined
                    : { backgroundColor: colorFromId(server.id) }
                }
              >
                {server.iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={server.iconUrl}
                    alt={server.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initials(server.name)
                )}
              </span>

              {/*
                Contador de nao lidas, no canto SUPERIOR DIREITO do icone.

                Sai um pouco para fora do quadrado (`-top-0.5 -right-0.5`) e
                leva um anel da cor do trilho: sem o anel, o vermelho encostado
                no icone vira uma mancha, e sem sair para fora ele some dentro
                das imagens escuras.

                `pointer-events-none` porque o alvo de clique e o servidor
                inteiro — a bolinha nao pode roubar o clique.

                Some sozinho quando o numero zera: `unread` e o unico dono
                dessa conta, e ele ja e limpo ao abrir o canal.
              */}
              {quantas > 0 ? (
                <span
                  aria-label={`${quantas} nao lidas em ${server.name}`}
                  className={cn(
                    "pointer-events-none absolute -right-0.5 -top-0.5",
                    "grid h-[18px] min-w-[18px] place-items-center rounded-full px-1",
                    "bg-signal-dnd text-[10px] font-bold leading-none text-white",
                    "ring-2 ring-base-900",
                  )}
                >
                  {quantas > 99 ? "99+" : quantas}
                </span>
              ) : null}
              </span>
            </Link>
          );
        })}

        {servers.length > 0 ? (
          <span className="h-px w-8 bg-base-700" />
        ) : null}

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          title="Adicionar servidor"
          className={cn(
            "grid h-11 w-11 place-items-center rounded-xl bg-base-800 text-ink-300",
            "transition-colors duration-150 hover:text-ink-100",
          )}
        >
          <Plus className="h-5 w-5" />
        </button>
      </nav>

      <CreateServerModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
