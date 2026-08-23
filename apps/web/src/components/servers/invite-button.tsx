"use client";

import { useState, useTransition } from "react";
import { Check, Copy, UserPlus } from "lucide-react";
import { getOrCreateInviteAction } from "@/server/actions/servers";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export function InviteButton({
  serverId,
  compact = false,
}: {
  serverId: string;
  /** so o icone — para caber no cabecalho estreito da coluna de canais */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function openModal() {
    setOpen(true);
    setCopied(false);
    startTransition(async () => {
      const result = await getOrCreateInviteAction(serverId);
      if (result.ok) {
        setCode(result.data.code);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Nao foi possivel copiar. Selecione o codigo manualmente.");
    }
  }

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={openModal}
          title="Convidar pessoas"
          aria-label="Convidar pessoas"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-400 transition-colors hover:bg-base-800 hover:text-ink-100"
        >
          <UserPlus className="h-4 w-4" />
        </button>
      ) : (
        <Button size="sm" variant="outline" onClick={openModal}>
          <UserPlus className="h-3.5 w-3.5" />
          Convidar
        </Button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Convidar pessoas"
        description="Compartilhe o codigo abaixo. Quem tiver o codigo entra pelo botao + na barra lateral."
      >
        {pending && !code ? (
          <p className="text-[13px] text-ink-400">Gerando convite...</p>
        ) : error ? (
          <p className="text-[13px] text-signal-dnd">{error}</p>
        ) : (
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border border-base-600 bg-base-900 px-3 py-2.5 font-mono text-sm tracking-[0.2em] text-accent-400">
              {code}
            </code>
            <Button size="icon" variant="secondary" onClick={copy} title="Copiar">
              {copied ? (
                <Check className="h-4 w-4 text-signal-online" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}
