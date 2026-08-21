"use client";

import { useState, useTransition } from "react";
import type { PublicMember, PublicRole } from "@aether/shared";
import { assignRoleAction, unassignRoleAction } from "@/server/actions/roles";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Atribuicao de cargos a um membro.
 *
 * A lista de cargos ja chega filtrada pela hierarquia de quem esta olhando —
 * e a action revalida a mesma regra no servidor (assertRoleHierarchy), entao
 * forjar o id de um cargo alto nao adianta nada.
 */
export function MemberRolesModal({
  serverId,
  member,
  roles,
  onClose,
}: {
  serverId: string;
  member: PublicMember;
  roles: PublicRole[];
  onClose: () => void;
}) {
  const [assigned, setAssigned] = useState<string[]>(
    member.roles.map((role) => role.id),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(roleId: string, next: boolean) {
    setError(null);
    // otimista: reverte se o servidor recusar
    const previous = assigned;
    setAssigned(next ? [...assigned, roleId] : assigned.filter((id) => id !== roleId));

    startTransition(async () => {
      const result = next
        ? await assignRoleAction(serverId, { memberId: member.id, roleId })
        : await unassignRoleAction(serverId, { memberId: member.id, roleId });

      if (!result.ok) {
        setAssigned(previous);
        setError(result.error);
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Cargos do membro"
      description="Marque os cargos deste membro. As mudancas valem na hora."
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5 rounded-md border border-base-700 bg-base-900 p-3">
          <Avatar
            userId={member.user.id}
            name={member.user.displayName}
            src={member.user.avatarUrl}
            status={member.user.status}
            size="sm"
          />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[13px] text-ink-100">
              {member.nickname ?? member.user.displayName}
            </p>
            <p className="truncate font-mono text-[11px] text-ink-500">
              @{member.user.username}
            </p>
          </div>
        </div>

        {roles.length === 0 ? (
          <p className="text-[13px] text-ink-400">
            Nao ha cargos que voce possa atribuir. Voce so gerencia cargos abaixo
            do seu na hierarquia.
          </p>
        ) : (
          <div className="flex flex-col gap-1 rounded-md border border-base-700 bg-base-900 p-2">
            {roles.map((role) => {
              const checked = assigned.includes(role.id);
              return (
                <label
                  key={role.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] transition-colors hover:bg-base-850",
                    role.isDefault && "opacity-60",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={role.isDefault || pending}
                    onChange={(event) => toggle(role.id, event.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--color-accent-500)]"
                  />
                  <span style={{ color: role.color }}>{role.name}</span>
                  {role.isDefault ? (
                    <span className="ml-auto font-mono text-[10px] text-ink-500">
                      padrao
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        )}

        <FieldError>{error}</FieldError>

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
