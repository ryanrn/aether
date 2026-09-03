"use client";

import { useState, useTransition } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import {
  BAN_DURATIONS,
  type BanDurationId,
  type PublicMember,
} from "@aether/shared";
import { banMemberAction, kickMemberAction } from "@/server/actions/moderation";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Expulsar ou banir um membro.
 *
 * Os dois no mesmo lugar de proposito: a diferenca entre eles e justamente o
 * que a pessoa precisa decidir, e separar em dois fluxos esconderia essa
 * escolha. Expulsar remove agora e a pessoa pode voltar por convite; banir
 * impede a volta.
 *
 * A confirmacao nao e `window.confirm`: moderacao merece ver o nome de quem
 * esta sendo atingido e o que exatamente vai acontecer.
 */
export function MemberModerationModal({
  serverId,
  member,
  mode,
  onClose,
}: {
  serverId: string;
  member: PublicMember;
  mode: "kick" | "ban";
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState<BanDurationId>("permanent");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const name = member.nickname ?? member.user.displayName;
  const isBan = mode === "ban";

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = isBan
        ? await banMemberAction(serverId, {
            memberId: member.id,
            reason: reason.trim() || undefined,
            duration,
          })
        : await kickMemberAction(serverId, {
            memberId: member.id,
            reason: reason.trim() || undefined,
          });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isBan ? `Banir ${name}` : `Expulsar ${name}`}
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] leading-relaxed text-ink-400">
          {isBan
            ? "A pessoa sai do servidor agora e nao consegue voltar, nem com convite, enquanto o banimento valer."
            : "A pessoa sai do servidor agora, mas pode voltar se receber um novo convite."}
        </p>

        {isBan ? (
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
              duracao
            </span>
            <div className="flex flex-wrap gap-1.5">
              {BAN_DURATIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setDuration(option.id)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-[12px] transition-colors",
                    duration === option.id
                      ? "border-signal-dnd/50 bg-signal-dnd/10 text-signal-dnd"
                      : "border-line text-ink-300 hover:bg-base-850",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-500">
            motivo (opcional)
          </span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Fica registrado no log de auditoria"
            className="resize-none rounded-md border border-line bg-base-950 px-3 py-2 text-[13px] text-ink-200 outline-none transition-colors focus:border-line-strong placeholder:text-ink-600"
          />
        </label>

        {error ? <p className="text-[12px] text-signal-dnd">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={submit} disabled={pending}>
            {isBan ? (
              <AetherIcon name="ban" className="h-3.5 w-3.5" />
            ) : (
              <AetherIcon name="user-minus" className="h-3.5 w-3.5" />
            )}
            {pending ? "Aplicando..." : isBan ? "Banir" : "Expulsar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
