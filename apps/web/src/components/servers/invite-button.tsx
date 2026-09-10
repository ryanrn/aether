"use client";

import { useState, useTransition } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import {
  getOrCreateInviteAction,
  revokeInviteAction,
} from "@/server/actions/servers";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { copiarTexto } from "@/lib/clipboard";

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

  /**
   * A URL completa, montada no cliente a partir da origem atual — funciona no
   * `aether-mocha-phi.vercel.app` de hoje e num dominio proprio amanha, sem
   * variavel nova. Vazia no SSR (nao renderiza o modal antes de abrir).
   */
  const url =
    code && typeof window !== "undefined"
      ? `${window.location.origin}/invite/${code}`
      : null;

  function carregar() {
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

  function openModal() {
    setOpen(true);
    carregar();
  }

  async function copy() {
    if (!url) return;
    if (await copiarTexto(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    }
    setError("Nao foi possivel copiar. Selecione o link manualmente.");
  }

  function revogar() {
    if (!code) return;
    setCopied(false);
    startTransition(async () => {
      const r = await revokeInviteAction(serverId, code);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // Revogado: gera outro na hora, o modal ja mostra o link novo.
      setCode(null);
      carregar();
    });
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
          <AetherIcon name="user-plus" className="h-4 w-4" />
        </button>
      ) : (
        <Button size="sm" variant="outline" onClick={openModal}>
          <AetherIcon name="user-plus" className="h-3.5 w-3.5" />
          Convidar
        </Button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Convidar pessoas"
        description="Quem abrir este link vê o servidor e entra com um clique. Funciona no navegador e no app."
      >
        {pending && !code ? (
          <p className="text-[13px] text-ink-400">Gerando convite...</p>
        ) : error && !code ? (
          <p className="text-[13px] text-signal-dnd">{error}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-line-strong bg-base-900 px-3 py-2.5 font-mono text-[13px] text-accent-400">
                {url}
              </code>
              <Button
                size="icon"
                variant="secondary"
                onClick={copy}
                title="Copiar link"
              >
                {copied ? (
                  <AetherIcon
                    name="check"
                    className="h-4 w-4 text-signal-online"
                  />
                ) : (
                  <AetherIcon name="copy" className="h-4 w-4" />
                )}
              </Button>
            </div>

            {error ? (
              <p className="text-[12px] text-signal-dnd">{error}</p>
            ) : null}

            <button
              type="button"
              onClick={revogar}
              disabled={pending}
              className="self-start text-[12px] text-ink-500 transition-colors hover:text-signal-dnd disabled:opacity-50"
            >
              Revogar este link e gerar um novo
            </button>
          </div>
        )}
      </Modal>
    </>
  );
}
