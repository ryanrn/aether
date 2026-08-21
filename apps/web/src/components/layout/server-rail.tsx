"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Plus } from "lucide-react";
import type { PublicServer } from "@aether/shared";
import { cn, colorFromId, initials } from "@/lib/utils";
import { CreateServerModal } from "@/components/servers/create-server-modal";

/**
 * Barra vertical de servidores. Estado ativo marcado por uma barra de acento
 * na borda esquerda (nao por preenchimento) para manter a interface calma.
 */
export function ServerRail({ servers }: { servers: PublicServer[] }) {
  const params = useParams<{ serverId?: string }>();
  const activeId = params?.serverId;
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <nav
        aria-label="Servidores"
        className="flex w-[72px] shrink-0 flex-col items-center gap-2 border-r border-base-800 bg-base-900 py-3"
      >
        {servers.map((server) => {
          const active = server.id === activeId;
          return (
            <Link
              key={server.id}
              href={`/app/s/${server.id}`}
              title={server.name}
              className="group relative flex w-full justify-center"
            >
              <span
                className={cn(
                  "absolute left-0 top-1/2 h-0 w-[3px] -translate-y-1/2 rounded-r-full bg-accent-500 transition-all duration-200",
                  active ? "h-7" : "group-hover:h-3.5",
                )}
              />
              <span
                className={cn(
                  "grid h-11 w-11 place-items-center overflow-hidden text-[13px] font-semibold text-ink-100",
                  "border transition-all duration-200",
                  active
                    ? "rounded-md border-accent-600/50 ring-accent-soft"
                    : "rounded-lg border-base-700 group-hover:rounded-md group-hover:border-base-600",
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
            </Link>
          );
        })}

        {servers.length > 0 ? (
          <span className="my-1 h-px w-8 bg-base-700" />
        ) : null}

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          title="Adicionar servidor"
          className={cn(
            "grid h-11 w-11 place-items-center rounded-lg border border-dashed border-base-600 text-ink-400",
            "transition-all duration-200 hover:rounded-md hover:border-accent-600/60 hover:text-accent-400",
          )}
        >
          <Plus className="h-5 w-5" />
        </button>
      </nav>

      <CreateServerModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
