"use client";

import { useState } from "react";
import { Crown, Shield } from "lucide-react";
import type { PublicMember, PublicRole, ViewerContext } from "@aether/shared";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MemberRolesModal } from "@/components/members/member-roles-modal";
import { canManageRole } from "@/lib/permissions";

export function MembersTab({
  serverId,
  members,
  roles,
  ownerId,
  viewer,
}: {
  serverId: string;
  members: PublicMember[];
  roles: PublicRole[];
  ownerId: string;
  viewer: ViewerContext;
}) {
  const [editing, setEditing] = useState<PublicMember | null>(null);
  const manageable = roles.filter((role) => canManageRole(viewer, role));

  return (
    <section className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-md border border-base-700">
        <table className="w-full">
          <thead>
            <tr className="border-b border-base-800 bg-base-900 text-left">
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                Membro
              </th>
              <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                Cargos
              </th>
              <th className="w-24 px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-base-800">
            {members.map((member) => {
              const isOwnerMember = member.user.id === ownerId;
              const editable =
                !isOwnerMember && member.id !== viewer.memberId && manageable.length > 0;

              return (
                <tr key={member.id} className="bg-base-950/40">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar
                        userId={member.user.id}
                        name={member.user.displayName}
                        src={member.user.avatarUrl}
                        status={member.user.status}
                        size="xs"
                      />
                      <div className="min-w-0 leading-tight">
                        <p className="flex items-center gap-1.5 truncate text-[13px] text-ink-100">
                          {member.nickname ?? member.user.displayName}
                          {isOwnerMember ? (
                            <Crown className="h-3 w-3 text-signal-idle" />
                          ) : null}
                        </p>
                        <p className="truncate font-mono text-[11px] text-ink-500">
                          @{member.user.username}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {member.roles.map((role) => (
                        <span
                          key={role.id}
                          className="rounded-[3px] border px-1.5 py-0.5 text-[11px]"
                          style={{
                            color: role.color,
                            borderColor: `color-mix(in srgb, ${role.color} 35%, transparent)`,
                          }}
                        >
                          {role.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {editable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing(member)}
                      >
                        <Shield className="h-3.5 w-3.5" />
                        Cargos
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[12px] text-ink-500">
        Expulsar, banir e silenciar entram na fase 6 (moderacao), junto com o log
        de auditoria — que ja esta sendo gravado desde a fase 1.
      </p>

      {editing ? (
        <MemberRolesModal
          serverId={serverId}
          member={editing}
          roles={manageable}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}
