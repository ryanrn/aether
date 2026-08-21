"use client";

import { useState, useTransition } from "react";
import {
  Ban,
  FolderPlus,
  Hash,
  Pencil,
  Plus,
  Shield,
  Ticket,
  Trash2,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { AuditEntry } from "@/server/services/audit-log";
import { loadAuditPageAction } from "@/server/actions/audit";
import { Button } from "@/components/ui/button";

/**
 * Log de auditoria.
 *
 * O registro existe desde a fase 1, entao esta tela nasce com historico real —
 * nao com uma lista vazia esperando o primeiro evento.
 *
 * Cada acao vira uma frase em vez de "channel.create". Quem le o log esta
 * respondendo "o que aconteceu aqui?", e nome de evento interno nao responde
 * isso.
 */

interface Descriptor {
  icon: LucideIcon;
  /** monta a frase; `alvo` ja vem resolvido pelo servidor */
  text: (entry: AuditEntry) => string;
  tone?: "danger" | "neutral";
}

const UNKNOWN = "algo que nao existe mais";

const DESCRIPTORS: Record<string, Descriptor> = {
  "server.create": {
    icon: Plus,
    text: () => "criou o servidor",
  },
  "server.update": {
    icon: Pencil,
    text: () => "alterou as configuracoes do servidor",
  },
  "server.join": { icon: UserPlus, text: () => "entrou no servidor" },
  "server.leave": { icon: UserMinus, text: () => "saiu do servidor" },
  "invite.create": { icon: Ticket, text: () => "gerou um convite" },
  "invite.use": { icon: UserPlus, text: () => "entrou por convite" },
  "channel.create": {
    icon: Hash,
    text: (e) => `criou o canal ${e.targetLabel ?? UNKNOWN}`,
  },
  "channel.update": {
    icon: Pencil,
    text: (e) => `editou o canal ${e.targetLabel ?? UNKNOWN}`,
  },
  "channel.delete": {
    icon: Trash2,
    text: (e) => `excluiu o canal ${e.targetLabel ?? UNKNOWN}`,
    tone: "danger",
  },
  "role.create": {
    icon: FolderPlus,
    text: (e) => `criou o cargo ${e.targetLabel ?? UNKNOWN}`,
  },
  "role.update": {
    icon: Shield,
    text: (e) =>
      e.targetType === "member"
        ? `alterou os cargos de ${e.targetLabel ?? UNKNOWN}` +
          (e.roleLabels.length > 0 ? ` (${e.roleLabels.join(", ")})` : "")
        : `editou o cargo ${e.targetLabel ?? UNKNOWN}`,
  },
  "role.delete": {
    icon: Trash2,
    text: (e) => `excluiu o cargo ${e.targetLabel ?? UNKNOWN}`,
    tone: "danger",
  },
  "member.kick": {
    icon: UserMinus,
    text: (e) => `expulsou ${e.targetLabel ?? UNKNOWN}`,
    tone: "danger",
  },
  "member.ban": {
    icon: Ban,
    text: (e) => {
      const duracao = e.metadata?.duration;
      const prazo =
        duracao === "permanent" || duracao === undefined
          ? "permanentemente"
          : `por ${String(duracao).replace("d", " dia(s)")}`;
      return `baniu ${e.targetLabel ?? UNKNOWN} ${prazo}`;
    },
    tone: "danger",
  },
  "member.unban": {
    icon: UserPlus,
    text: (e) => `revogou o banimento de ${e.targetLabel ?? UNKNOWN}`,
  },
};

function describe(entry: AuditEntry): Descriptor {
  return (
    DESCRIPTORS[entry.action] ?? {
      icon: Pencil,
      // Acao nova sem descritor ainda: melhor mostrar o nome cru do que sumir
      // com a linha e dar a impressao de que nada aconteceu.
      text: () => entry.action,
    }
  );
}

export function AuditTab({
  serverId,
  initialEntries,
  initialHasMore,
}: {
  serverId: string;
  initialEntries: AuditEntry[];
  initialHasMore: boolean;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function loadMore() {
    const last = entries[entries.length - 1];
    if (!last) return;
    setError(null);
    startTransition(async () => {
      const result = await loadAuditPageAction(serverId, last.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEntries((current) => [...current, ...result.data.entries]);
      setHasMore(result.data.hasMore);
    });
  }

  if (entries.length === 0) {
    return (
      <section className="rounded-md border border-base-700 p-6 text-center">
        <p className="text-[13px] text-ink-400">Nada registrado ainda.</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <ul className="flex flex-col">
        {entries.map((entry) => {
          const descriptor = describe(entry);
          const Icon = descriptor.icon;
          return (
            <li
              key={entry.id}
              className="flex items-start gap-3 border-b border-base-800 py-2.5 last:border-b-0"
            >
              <Icon
                className={
                  descriptor.tone === "danger"
                    ? "mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-dnd"
                    : "mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-500"
                }
              />

              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-snug text-ink-200">
                  <span className="font-medium text-ink-100">
                    {entry.actor?.displayName ?? "Alguem que saiu"}
                  </span>{" "}
                  {descriptor.text(entry)}
                </p>
                {entry.reason ? (
                  <p className="mt-0.5 truncate text-[12px] text-ink-500">
                    motivo: {entry.reason}
                  </p>
                ) : null}
              </div>

              {/* Fuso do leitor; o servidor renderiza em outro. */}
              <time
                dateTime={entry.createdAt}
                suppressHydrationWarning
                className="shrink-0 font-mono text-[10px] leading-5 text-ink-600"
              >
                {new Date(entry.createdAt).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </li>
          );
        })}
      </ul>

      {error ? <p className="text-[12px] text-signal-dnd">{error}</p> : null}

      {hasMore ? (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={pending}>
            {pending ? "Carregando..." : "Carregar mais"}
          </Button>
        </div>
      ) : (
        <p className="pt-2 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-ink-600">
          inicio do registro
        </p>
      )}
    </section>
  );
}
