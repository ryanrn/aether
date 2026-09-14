"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AetherIcon } from "@/components/ui/aether-icon";
import type { ActionResult } from "@aether/shared";
import { loginAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input } from "@/components/ui/field";
import { Totp2faStep } from "./totp-2fa-step";

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
      {!pending && <AetherIcon name="login" className="h-4 w-4" />}
    </Button>
  );
}

export function LoginForm({
  next = "",
  precisa2faInicial = false,
}: {
  next?: string;
  /** cookie de 2FA pendente ja valido ao carregar a pagina (ver `login/page.tsx`) */
  precisa2faInicial?: boolean;
}) {
  const [state, formAction] = useActionState<
    ActionResult<{ precisa2fa: true } | undefined> | null,
    FormData
  >(loginAction, null);
  const error = state && !state.ok ? state : null;

  /**
   * Senha certa, mas a conta tem 2FA — `loginAction` nao criou sessao
   * nenhuma, so o cookie de 10min que prova que a senha ja foi confirmada.
   * Troca de tela AQUI, sem navegar: o `next` original precisa sobreviver
   * para o segundo passo. `precisa2faInicial` cobre o reload no meio do
   * fluxo (o cookie sobrevive; o estado do React, sem isto, nao sobreviveria).
   */
  if (precisa2faInicial || (state?.ok && state.data?.precisa2fa)) {
    return <Totp2faStep next={next} />;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field label="Usuario ou e-mail" required>
        <Input
          name="identifier"
          autoComplete="username"
          autoFocus
          required
          aria-invalid={error?.field === "identifier"}
        />
      </Field>

      <Field label="Senha" required>
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={error?.field === "password"}
        />
      </Field>

      <FieldError>{error?.error}</FieldError>

      <SubmitButton />
    </form>
  );
}
