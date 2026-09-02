"use client";

import { useMemo, useState, useTransition } from "react";
import { AetherIcon } from "@/components/ui/aether-icon";
import {
  PERMISSION_METADATA,
  Permission,
  toKeys,
  type PermissionKey,
  type PublicRole,
  type ViewerContext,
} from "@aether/shared";
import {
  createRoleAction,
  deleteRoleAction,
  updateRoleAction,
} from "@/server/actions/roles";
import { canManageRole, viewerCan } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FieldError, Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/utils";

const GROUP_LABEL: Record<string, string> = {
  geral: "Geral",
  canais: "Canais",
  voz: "Voz e tela",
  moderacao: "Moderacao",
};

/**
 * Editor de cargos.
 *
 * Duas regras visiveis na interface (e reforcadas no servidor):
 *  - cargos acima do seu aparecem em modo leitura;
 *  - permissoes que voce nao possui aparecem travadas, porque conceder o que
 *    nao se tem seria escalada de privilegio.
 */
export function RolesTab({
  serverId,
  roles,
  viewer,
}: {
  serverId: string;
  roles: PublicRole[];
  viewer: ViewerContext;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    roles[0]?.id ?? null,
  );
  const selected =
    roles.find((role) => role.id === selectedId) ?? roles[0] ?? null;

  return (
    <section className="grid gap-6 md:grid-cols-[220px_1fr]">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5 rounded-md border border-base-700 bg-base-900 p-1">
          {roles.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => setSelectedId(role.id)}
              className={cn(
                "flex items-center gap-2 rounded-sm px-2.5 py-2 text-left text-[13px] transition-colors",
                selected?.id === role.id
                  ? "bg-base-750 text-ink-100"
                  : "text-ink-300 hover:bg-base-850",
              )}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: role.color }}
              />
              <span className="truncate">{role.name}</span>
              {role.isOwner ? (
                <span className="ml-auto font-mono text-[9px] uppercase text-ink-500">
                  dono
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {viewerCan(viewer, "MANAGE_ROLES") ? (
          <CreateRoleButton serverId={serverId} />
        ) : null}
      </div>

      {selected ? (
        <RoleEditor
          key={selected.id}
          serverId={serverId}
          role={selected}
          viewer={viewer}
        />
      ) : null}
    </section>
  );
}

function CreateRoleButton({ serverId }: { serverId: string }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    if (name.trim() === "") return;
    setError(null);
    startTransition(async () => {
      const result = await createRoleAction({
        serverId,
        name: name.trim(),
        color: "#6B7280",
      });
      if (result.ok) setName("");
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-base-700 bg-base-900 p-2">
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Novo cargo"
        maxLength={32}
        onKeyDown={(event) => {
          if (event.key === "Enter") create();
        }}
      />
      <Button
        size="sm"
        onClick={create}
        disabled={pending || name.trim() === ""}
      >
        <AetherIcon name="plus" className="h-3.5 w-3.5" />
        Criar cargo
      </Button>
      <FieldError>{error}</FieldError>
    </div>
  );
}

function RoleEditor({
  serverId,
  role,
  viewer,
}: {
  serverId: string;
  role: PublicRole;
  viewer: ViewerContext;
}) {
  const editable = canManageRole(viewer, role);
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color);
  /**
   * toKeys() vem do shared e le o bitfield pela tabela canonica de flags.
   * Nunca derive o bit a partir da ordem de um objeto de metadados — as duas
   * listas podem divergir e o resultado seriam permissoes trocadas.
   */
  const [permissions, setPermissions] = useState<PermissionKey[]>(() =>
    toKeys(BigInt(role.permissions)),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const grouped = useMemo(() => {
    const map = new Map<string, PermissionKey[]>();
    // itera pela tabela canonica de flags, nao pelos metadados
    for (const key of Object.keys(Permission) as PermissionKey[]) {
      const group = PERMISSION_METADATA[key].group;
      map.set(group, [...(map.get(group) ?? []), key]);
    }
    return map;
  }, []);

  function toggle(key: PermissionKey, checked: boolean) {
    setSaved(false);
    setPermissions((prev) =>
      checked ? [...prev, key] : prev.filter((item) => item !== key),
    );
  }

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateRoleAction(serverId, {
        roleId: role.id,
        name,
        color,
        permissions,
      });
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {!editable ? (
        <p className="rounded-md border border-base-700 bg-base-900 px-3 py-2.5 text-[13px] text-ink-400">
          {role.isOwner
            ? "O cargo do dono nao pode ser editado por ninguem."
            : "Este cargo esta acima do seu na hierarquia — voce so pode visualizar."}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <Field label="Nome do cargo">
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
            maxLength={32}
            disabled={!editable}
          />
        </Field>
        <Field label="Cor">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              disabled={!editable}
              onChange={(event) => {
                setColor(event.target.value);
                setSaved(false);
              }}
              className="h-10 w-12 cursor-pointer rounded-md border border-base-600 bg-base-900 disabled:cursor-not-allowed"
            />
            <span className="font-mono text-[12px] text-ink-400">{color}</span>
          </div>
        </Field>
      </div>

      <div className="flex flex-col gap-4">
        <Label>Permissoes</Label>
        {[...grouped.entries()].map(([group, keys]) => (
          <div
            key={group}
            className="rounded-md border border-base-700 bg-base-900"
          >
            <p className="border-b border-base-800 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
              {GROUP_LABEL[group] ?? group}
            </p>
            <div className="flex flex-col divide-y divide-base-800">
              {keys.map((key) => {
                const meta = PERMISSION_METADATA[key];
                const viewerHas = viewerCan(viewer, key);
                const locked = !editable || !viewerHas;

                return (
                  <label
                    key={key}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors",
                      locked
                        ? "cursor-not-allowed opacity-55"
                        : "hover:bg-base-850",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={permissions.includes(key)}
                      disabled={locked}
                      onChange={(event) => toggle(key, event.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-accent-500)]"
                    />
                    <span className="leading-tight">
                      <span className="block text-[13px] text-ink-200">
                        {meta.label}
                      </span>
                      <span className="block text-[11px] text-ink-500">
                        {meta.description}
                        {!viewerHas && editable
                          ? " · voce nao possui esta permissao"
                          : ""}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <FieldError>{error}</FieldError>

      {editable ? (
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={save} disabled={pending}>
            {pending ? "Salvando..." : "Salvar cargo"}
          </Button>
          {saved ? (
            <span className="text-[13px] text-signal-online">Salvo.</span>
          ) : null}
          {!role.isDefault ? (
            <DeleteRoleButton serverId={serverId} role={role} />
          ) : (
            <span className="ml-auto text-[12px] text-ink-500">
              Cargo padrao — nao pode ser excluido
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DeleteRoleButton({
  serverId,
  role,
}: {
  serverId: string;
  role: PublicRole;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState(false);

  return (
    <>
      <Button
        variant="danger"
        className="ml-auto"
        disabled={pending}
        onClick={() => setConfirmando(true)}
      >
        <AetherIcon name="trash" className="h-3.5 w-3.5" />
        Excluir cargo
      </Button>

      <ConfirmDialog
        open={confirmando}
        onClose={() => setConfirmando(false)}
        title="Excluir cargo"
        confirmLabel="Excluir cargo"
        pending={pending}
        onConfirm={() => {
          startTransition(async () => {
            await deleteRoleAction(serverId, role.id);
            setConfirmando(false);
          });
        }}
      >
        Tem certeza de que deseja excluir{" "}
        <strong className="text-ink-100">{role.name}</strong>? Quem tiver este
        cargo perde as permissoes dele na hora.
      </ConfirmDialog>
    </>
  );
}
