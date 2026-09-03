"use client";

import { useState, useTransition } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import type { PublicMember } from "@aether/shared";
import { transferOwnershipAction } from "@/server/actions/servers";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Field, FieldError, Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * Transferir a posse do servidor para outro membro.
 *
 * A senha nao e cosmetica: e a acao que muda o pouco no servidor inteiro (e o
 * cargo "Dono" migra junto — ver o comentario da action). Errar o clique aqui
 * custa caro, entao a confirmacao pede a mesma prova que um login pediria.
 */
export function TransferOwnershipModal({
  serverId,
  members,
  onClose,
}: {
  serverId: string;
  /** membros elegiveis — o dono atual ja vem excluido por quem chama */
  members: PublicMember[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const alvo = members.find((member) => member.id === selected) ?? null;

  function submit() {
    if (!selected || !password) return;
    setError(null);
    startTransition(async () => {
      const result = await transferOwnershipAction({
        serverId,
        targetMemberId: selected,
        password,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <Modal open onClose={onClose} title="Transferir posse do servidor">
      <div className="flex flex-col gap-4">
        <p className="text-[13px] leading-relaxed text-ink-400">
          A pessoa escolhida passa a ser a dona de verdade: pode gerenciar
          cargos, excluir o servidor e voce deixa de ter esse poder. Nao ha como
          desfazer sozinho — so a nova dona pode devolver.
        </p>

        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-line p-1.5">
          {members.length === 0 ? (
            <p className="px-2 py-3 text-center text-[13px] text-ink-500">
              Nao ha outro membro para receber a posse.
            </p>
          ) : (
            members.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => setSelected(member.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors",
                  selected === member.id
                    ? "bg-accent-500/15 text-ink-100"
                    : "text-ink-300 hover:bg-base-850",
                )}
              >
                <Avatar
                  userId={member.user.id}
                  name={member.user.displayName}
                  src={member.user.avatarUrl}
                  moldura={member.user.moldura}
                  status={member.user.status}
                  size="xs"
                />
                <span className="min-w-0 truncate text-[13px]">
                  {member.nickname ?? member.user.displayName}
                </span>
                <span className="truncate font-mono text-[11px] text-ink-500">
                  @{member.user.username}
                </span>
              </button>
            ))
          )}
        </div>

        <Field label="Sua senha" required>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Confirme com a senha da sua conta"
          />
        </Field>

        {error ? <FieldError>{error}</FieldError> : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={submit}
            disabled={pending || !selected || !password}
          >
            <AetherIcon name="crown" className="h-3.5 w-3.5" />
            {pending
              ? "Transferindo..."
              : alvo
                ? `Transferir para ${alvo.nickname ?? alvo.user.displayName}`
                : "Transferir"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
