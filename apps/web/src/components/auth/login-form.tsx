"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AetherIcon } from "@/components/ui/aether-icon";
import type { ActionResult } from "@aether/shared";
import { loginAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input } from "@/components/ui/field";
import { GoogleButton } from "./google-button";
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
  const [senhaVisivel, setSenhaVisivel] = useState(false);

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
      <Field label="E-mail ou nome de usuário" required>
        <Input
          name="identifier"
          autoComplete="username"
          autoFocus
          required
          aria-invalid={error?.field === "identifier"}
        />
      </Field>

      <Field label="Senha" required>
        <div className="relative">
          <Input
            name="password"
            type={senhaVisivel ? "text" : "password"}
            autoComplete="current-password"
            required
            className="pr-11"
            aria-invalid={error?.field === "password"}
          />
          <button
            type="button"
            onClick={() => setSenhaVisivel((v) => !v)}
            aria-pressed={senhaVisivel}
            aria-label={senhaVisivel ? "Ocultar senha" : "Mostrar senha"}
            className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-sm text-ink-400 transition-colors hover:bg-white/5 hover:text-ink-100"
          >
            <AetherIcon name={senhaVisivel ? "eye-off" : "eye"} className="h-4 w-4" />
          </button>
        </div>
      </Field>

      <div className="-mt-1.5 flex justify-end">
        <Link
          href="/esqueci"
          className="text-[13px] text-ink-400 transition-colors hover:text-ink-200"
        >
          Esqueceu sua senha?
        </Link>
      </div>

      <FieldError>{error?.error}</FieldError>

      <SubmitButton />

      <div
        role="separator"
        aria-orientation="horizontal"
        className="my-1.5 flex items-center gap-3 text-[12.5px] text-ink-500 before:h-px before:flex-1 before:bg-line before:content-[''] after:h-px after:flex-1 after:bg-line after:content-['']"
      >
        ou
      </div>

      <GoogleButton next={next} />
    </form>
  );
}
