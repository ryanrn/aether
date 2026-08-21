"use client";

import { useState, useTransition } from "react";
import {
  createCategoryAction,
  renameCategoryAction,
} from "@/server/actions/channels";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";

type State =
  | { mode: "create" }
  | { mode: "edit"; categoryId: string; name: string };

export function CategoryFormModal({
  serverId,
  state,
  onClose,
}: {
  serverId: string;
  state: State;
  onClose: () => void;
}) {
  const isEdit = state.mode === "edit";
  const [name, setName] = useState(isEdit ? state.name : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = isEdit
        ? await renameCategoryAction(serverId, {
            categoryId: (state as { categoryId: string }).categoryId,
            name,
          })
        : await createCategoryAction({ serverId, name });

      if (result.ok) onClose();
      else setError(result.error);
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? "Renomear categoria" : "Nova categoria"}
      description="Categorias agrupam canais na barra lateral."
    >
      <div className="flex flex-col gap-4">
        <Field label="Nome">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            autoFocus
            placeholder="GAMING"
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
        </Field>

        <FieldError>{error}</FieldError>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending}>
            {pending ? "Salvando..." : isEdit ? "Salvar" : "Criar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
