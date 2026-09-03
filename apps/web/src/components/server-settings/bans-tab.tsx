"use client";

import { useState, useTransition } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import type { ServerBan } from "@/server/services/moderation";
import { unbanAction } from "@/server/actions/moderation";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

/**
 * Banimentos ativos, com opcao de revogar.
 *
 * Vencidos nao aparecem: a consulta ja filtra por vencimento. Eles continuam na
 * tabela como historico, e o log de auditoria guarda quem baniu e por que.
 */
export function BansTab({
  serverId,
  bans,
}: {
  serverId: string;
  bans: ServerBan[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function revoke(userId: string) {
    setError(null);
    setPendingUser(userId);
    startTransition(async () => {
      const result = await unbanAction(serverId, { userId });
      setPendingUser(null);
      if (!result.ok) setError(result.error);
    });
  }

  if (bans.length === 0) {
    return (
      <section className="rounded-md border border-line p-6 text-center">
        <p className="text-[13px] text-ink-400">Nenhum banimento ativo.</p>
        <p className="mt-1 text-[12px] text-ink-500">
          Banimentos vencidos saem desta lista sozinhos, mas continuam no log de
          auditoria.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      {error ? <p className="text-[12px] text-signal-dnd">{error}</p> : null}

      <ul className="flex flex-col gap-1.5">
        {bans.map((ban) => (
          <li
            key={ban.userId}
            className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5"
          >
            <Avatar
              userId={ban.user.id}
              name={ban.user.displayName}
              src={ban.user.avatarUrl}
              moldura={ban.user.moldura}
              size="sm"
            />

            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-ink-100">
                {ban.user.displayName}
                <span className="select-text ml-1.5 font-mono text-[11px] text-ink-500">
                  @{ban.user.username}
                </span>
              </p>
              <p className="truncate text-[12px] text-ink-500">
                {ban.reason ? ban.reason : "sem motivo registrado"}
                {" · "}
                {ban.expiresAt ? (
                  <span suppressHydrationWarning>
                    ate {new Date(ban.expiresAt).toLocaleString("pt-BR")}
                  </span>
                ) : (
                  "permanente"
                )}
                {ban.issuedBy ? ` · por ${ban.issuedBy.displayName}` : ""}
              </p>
            </div>

            <Button
              size="sm"
              variant="outline"
              disabled={pendingUser === ban.userId}
              onClick={() => revoke(ban.userId)}
            >
              <AetherIcon name="rotate-ccw" className="h-3.5 w-3.5" />
              {pendingUser === ban.userId ? "Revogando..." : "Revogar"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
