"use client";

import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { AetherIcon } from "@/components/ui/aether-icon";
import type { ActionResult } from "@aether/shared";
import {
  cancelarLogin2faAction,
  verificarTotpDoLoginAction,
} from "@/server/actions/auth";
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
      {pending ? "Verificando..." : "Verificar"}
      {!pending && <AetherIcon name="shield-check" className="h-4 w-4" />}
    </Button>
  );
}

/**
 * Segundo passo do login — so aparece quando `loginAction` ja confirmou a
 * senha e devolveu `precisa2fa`. A senha nao volta a ser pedida aqui: quem
 * prova que ela ja foi confirmada e o cookie curto que `loginAction` deixou.
 */
export function Totp2faStep({ next = "" }: { next?: string }) {
  const [state, formAction] = useActionState<
    ActionResult<undefined> | null,
    FormData
  >(verificarTotpDoLoginAction, null);
  const error = state && !state.ok ? state : null;
  const [voltando, startVoltar] = useTransition();

  function voltar() {
    startVoltar(async () => {
      await cancelarLogin2faAction();
      // Recarrega a pagina — `useActionState` nao tem como "esquecer" o
      // estado anterior sozinho, e um reload devolve o formulario de senha
      // do zero, sem cookie de 2FA pendente.
      window.location.reload();
    });
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="flex items-center gap-2 text-[13px] text-ink-300">
        <AetherIcon name="shield" className="h-4 w-4 text-accent-400" />
        Confirme com o codigo do seu aplicativo autenticador
      </div>

      <Field
        label="Codigo"
        hint="6 digitos do autenticador, ou um codigo de backup"
        required
      >
        <Input
          name="codigo"
          inputMode="text"
          autoComplete="one-time-code"
          autoFocus
          required
          aria-invalid={error?.field === "codigo"}
        />
      </Field>

      <FieldError>{error?.error}</FieldError>

      <SubmitButton />

      <button
        type="button"
        onClick={voltar}
        disabled={voltando}
        className="text-center text-[13px] text-ink-400 transition-colors hover:text-ink-200 disabled:opacity-50"
      >
        Voltar
      </button>
    </form>
  );
}
