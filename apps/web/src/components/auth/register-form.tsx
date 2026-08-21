"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { UserPlus } from "lucide-react";
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
      {!pending && <UserPlus className="h-4 w-4" />}
    </Button>
  );
}

export function RegisterForm() {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    registerAction,
    null,
  );
  const error = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Usuario">
          <Input
            name="username"
            autoComplete="username"
            autoFocus
            required
            minLength={3}
            maxLength={24}
            placeholder="ryan"
            aria-invalid={error?.field === "username"}
          />
        </Field>
        <Field label="Nome exibido">
          <Input
            name="displayName"
            autoComplete="nickname"
            required
            maxLength={32}
            placeholder="Ryan"
            aria-invalid={error?.field === "displayName"}
          />
        </Field>
      </div>

      <Field label="E-mail">
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="voce@exemplo.com"
          aria-invalid={error?.field === "email"}
        />
      </Field>

      <Field label="Senha" hint="Minimo de 8 caracteres.">
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="••••••••"
          aria-invalid={error?.field === "password"}
        />
      </Field>

      <FieldError>{error?.error}</FieldError>

      <SubmitButton />
    </form>
  );
}
