"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LogIn } from "lucide-react";
import type { ActionResult } from "@aether/shared";
import { loginAction } from "@/server/actions/auth";
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
      {pending ? "Entrando..." : "Entrar"}
      {!pending && <LogIn className="h-4 w-4" />}
    </Button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    loginAction,
    null,
  );
  const error = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Usuario ou e-mail">
        <Input
          name="identifier"
          autoComplete="username"
          autoFocus
          required
          placeholder="ryan"
          aria-invalid={error?.field === "identifier"}
        />
      </Field>

      <Field label="Senha">
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          aria-invalid={error?.field === "password"}
        />
      </Field>

      <FieldError>{error?.error}</FieldError>

      <SubmitButton />
    </form>
  );
}
