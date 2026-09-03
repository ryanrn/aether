"use client";

import { useActionState, useState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@aether/shared";
import { createServerAction, joinServerAction } from "@/server/actions/servers";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

type Tab = "create" | "join";

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="primary"
      size="lg"
      className="w-full"
      disabled={pending}
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function CreateServerModal({
  open,
  onClose,
  initialTab = "create",
}: {
  open: boolean;
  onClose: () => void;
  /** aba aberta ao surgir — quem chama pode mirar direto em "entrar por convite" */
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  // Reabrir por outro caminho deve respeitar o novo alvo, nao a aba anterior.
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  const [createState, createFormAction] = useActionState<
    ActionResult<{ serverId: string }> | null,
    FormData
  >(createServerAction, null);
  const [joinState, joinFormAction] = useActionState<
    ActionResult<{ serverId: string }> | null,
    FormData
  >(joinServerAction, null);

  const createError = createState && !createState.ok ? createState.error : null;
  const joinError = joinState && !joinState.ok ? joinState.error : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adicionar servidor"
      description="Crie uma comunidade nova ou entre com um convite."
    >
      <div className="mb-4 flex gap-1 rounded-md border border-line bg-base-900 p-1">
        {(
          [
            ["create", "Criar servidor"],
            ["join", "Entrar com convite"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "flex-1 rounded-sm px-3 py-1.5 text-[13px] transition-colors duration-150",
              tab === value
                ? "bg-base-700 text-ink-100"
                : "text-ink-400 hover:text-ink-200",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "create" ? (
        <form action={createFormAction} className="flex flex-col gap-4">
          <Field
            label="Nome do servidor"
            hint="Canais e cargos padrao sao criados junto."
          >
            <Input
              name="name"
              required
              minLength={2}
              maxLength={48}
              placeholder="Meu servidor"
            />
          </Field>
          <FieldError>{createError}</FieldError>
          <Submit label="Criar servidor" pendingLabel="Criando..." />
        </form>
      ) : (
        <form action={joinFormAction} className="flex flex-col gap-4">
          <Field label="Codigo do convite" hint="Ex.: k3m9xq2p">
            <Input
              name="code"
              required
              minLength={6}
              maxLength={24}
              placeholder="k3m9xq2p"
              className="font-mono tracking-[0.14em]"
            />
          </Field>
          <FieldError>{joinError}</FieldError>
          <Submit label="Entrar no servidor" pendingLabel="Entrando..." />
        </form>
      )}
    </Modal>
  );
}
