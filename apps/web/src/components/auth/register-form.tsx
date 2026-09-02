"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AetherIcon } from "@/components/ui/aether-icon";
import type { ActionResult } from "@aether/shared";
import { registerAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input } from "@/components/ui/field";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="primary"
      size="lg"
      className="w-full"
      disabled={pending}
    >
      {pending ? "Criando conta..." : "Criar conta"}
      {!pending && <AetherIcon name="user-plus" className="h-4 w-4" />}
    </Button>
  );
}

export function RegisterForm() {
  const [state, formAction] = useActionState<
    ActionResult<undefined> | null,
    FormData
  >(registerAction, null);
  const error = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Usuario" hint="3 a 24 caracteres." required>
          <Input
            name="username"
            autoComplete="username"
            autoFocus
            required
            minLength={3}
            maxLength={24}
            aria-invalid={error?.field === "username"}
          />
        </Field>
        <Field label="Nome exibido" required>
          <Input
            name="displayName"
            autoComplete="nickname"
            required
            maxLength={32}
            aria-invalid={error?.field === "displayName"}
          />
        </Field>
      </div>

      <Field label="E-mail" required>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={error?.field === "email"}
        />
      </Field>

      <Field label="Senha" hint="Minimo de 8 caracteres." required>
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          aria-invalid={error?.field === "password"}
        />
      </Field>

      <FieldError>{error?.error}</FieldError>

      <SubmitButton />
    </form>
  );
}
