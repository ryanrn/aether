"use client";

import { useEffect, useState, useTransition } from "react";
import { Hash, Volume2 } from "lucide-react";
import type { PublicCategory, PublicRole } from "@aether/shared";
import {
  createChannelAction,
  getChannelForEditAction,
  setChannelAccessAction,
  updateChannelAction,
} from "@/server/actions/channels";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input, Label } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

type State =
  | { mode: "create"; categoryId: string | null }
  | { mode: "edit"; channelId: string };

interface FormValues {
  name: string;
  type: "TEXT" | "VOICE";
  categoryId: string | null;
  isPrivate: boolean;
  isTemporary: boolean;
  userLimit: string;
  topic: string;
  allowedRoleIds: string[];
}

const EMPTY: FormValues = {
  name: "",
  type: "VOICE",
  categoryId: null,
  isPrivate: false,
  isTemporary: false,
  userLimit: "",
  topic: "",
  allowedRoleIds: [],
};

/**
 * Modal unico para criar e editar canal.
 *
 * No modo edicao os dados sao buscados por uma action (que revalida a
 * permissao EDIT_CHANNEL) em vez de virem embutidos na arvore: assim a
 * sidebar continua leve e nenhum dado de canal privado trafega sem checagem.
 */
export function ChannelFormModal({
  serverId,
  categories,
  roles,
  state,
  onClose,
}: {
  serverId: string;
  categories: PublicCategory[];
  roles: PublicRole[];
  state: State;
  onClose: () => void;
}) {
  const isEdit = state.mode === "edit";
  const [values, setValues] = useState<FormValues>(
    state.mode === "create" ? { ...EMPTY, categoryId: state.categoryId } : EMPTY,
  );
  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (state.mode !== "edit") return;
    let cancelled = false;

    (async () => {
      const result = await getChannelForEditAction(serverId, state.channelId);
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        setLoading(false);
        return;
      }
      setValues({
        name: result.data.name,
        type: result.data.type,
        categoryId: result.data.categoryId,
        isPrivate: result.data.isPrivate,
        isTemporary: result.data.isTemporary,
        userLimit: result.data.userLimit ? String(result.data.userLimit) : "",
        topic: result.data.topic ?? "",
        allowedRoleIds: result.data.allowedRoleIds,
      });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [serverId, state]);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    setError(null);
    const userLimit = values.userLimit === "" ? "" : Number(values.userLimit);

    startTransition(async () => {
      if (!isEdit) {
        const result = await createChannelAction({
          serverId,
          name: values.name,
          type: values.type,
          categoryId: values.categoryId,
          isPrivate: values.isPrivate,
          isTemporary: values.isTemporary,
          userLimit,
          allowedRoleIds: values.allowedRoleIds,
        });
        if (result.ok) onClose();
        else setError(result.error);
        return;
      }

      const channelId = (state as { channelId: string }).channelId;
      const result = await updateChannelAction(serverId, {
        channelId,
        name: values.name,
        topic: values.topic.trim() === "" ? null : values.topic,
        categoryId: values.categoryId,
        isPrivate: values.isPrivate,
        isTemporary: values.isTemporary,
        userLimit,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      /**
       * updateChannel limpa os overwrites quando o canal deixa de ser privado.
       * Continuando privado, regravamos a lista de acesso logo depois — em
       * sequencia, nunca em paralelo, para nao competir com a propria limpeza.
       */
      if (values.isPrivate) {
        const access = await setChannelAccessAction(serverId, {
          channelId,
          roleIds: values.allowedRoleIds,
        });
        if (!access.ok) {
          setError(access.error);
          return;
        }
      }

      onClose();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? "Editar canal" : "Criar canal"}
      description={
        isEdit
          ? "Alteracoes valem para todos os membros imediatamente."
          : "Canais de voz aceitam limite de pessoas; canais de texto, nao."
      }
    >
      {loading ? (
        <p className="text-[13px] text-ink-400">Carregando...</p>
      ) : (
        <div className="flex flex-col gap-4">
          {!isEdit ? (
            <div className="flex flex-col gap-1.5">
              <Label>Tipo</Label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["VOICE", "Voz", Volume2],
                    ["TEXT", "Texto", Hash],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set("type", value)}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2.5 text-[13px] transition-colors",
                      values.type === value
                        ? "border-accent-600/60 bg-accent-500/8 text-ink-100"
                        : "border-base-600 text-ink-400 hover:border-base-500 hover:text-ink-200",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <Field label="Nome">
            <Input
              value={values.name}
              onChange={(event) => set("name", event.target.value)}
              maxLength={40}
              autoFocus
              placeholder={values.type === "VOICE" ? "Lobby" : "geral"}
            />
          </Field>

          {isEdit ? (
            <Field label="Topico" hint="Aparece no cabecalho do canal.">
              <Input
                value={values.topic}
                onChange={(event) => set("topic", event.target.value)}
                maxLength={200}
                placeholder="Opcional"
              />
            </Field>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label>Categoria</Label>
            <select
              value={values.categoryId ?? ""}
              onChange={(event) =>
                set("categoryId", event.target.value === "" ? null : event.target.value)
              }
              className="h-10 w-full rounded-md border border-base-600 bg-base-900 px-3 text-sm text-ink-100 transition-colors hover:border-base-500 focus:border-accent-600 focus:outline-none"
            >
              <option value="">Sem categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          {values.type === "VOICE" ? (
            <Field label="Limite de usuarios" hint="Vazio = sem limite.">
              <Input
                type="number"
                min={1}
                max={99}
                value={values.userLimit}
                onChange={(event) => set("userLimit", event.target.value)}
                placeholder="Sem limite"
              />
            </Field>
          ) : null}

          <div className="flex flex-col gap-2 rounded-md border border-base-700 bg-base-900 p-3">
            <Toggle
              checked={values.isPrivate}
              onChange={(checked) => set("isPrivate", checked)}
              label="Canal privado"
              hint="Somente os cargos marcados enxergam o canal."
            />
            <Toggle
              checked={values.isTemporary}
              onChange={(checked) => set("isTemporary", checked)}
              label="Canal temporario"
              hint="Sera removido ao esvaziar (efetivo na fase 3)."
            />
          </div>

          {values.isPrivate ? (
            <div className="flex flex-col gap-2">
              <Label>Cargos com acesso</Label>
              <div className="flex flex-col gap-1 rounded-md border border-base-700 bg-base-900 p-2">
                {roles
                  .filter((role) => !role.isOwner)
                  .map((role) => {
                    const checked = values.allowedRoleIds.includes(role.id);
                    return (
                      <label
                        key={role.id}
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] transition-colors hover:bg-base-850"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            set(
                              "allowedRoleIds",
                              event.target.checked
                                ? [...values.allowedRoleIds, role.id]
                                : values.allowedRoleIds.filter((id) => id !== role.id),
                            )
                          }
                          className="h-3.5 w-3.5 accent-[var(--color-accent-500)]"
                        />
                        <span style={{ color: role.color }}>{role.name}</span>
                      </label>
                    );
                  })}
                <p className="px-2 pt-1 text-[11px] text-ink-500">
                  O dono e quem tem Administrar servidor sempre enxergam.
                </p>
              </div>
            </div>
          ) : null}

          <FieldError>{error}</FieldError>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={submit} disabled={pending}>
              {pending ? "Salvando..." : isEdit ? "Salvar" : "Criar canal"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-accent-500)]"
      />
      <span className="leading-tight">
        <span className="block text-[13px] text-ink-200">{label}</span>
        <span className="block text-[11px] text-ink-500">{hint}</span>
      </span>
    </label>
  );
}
