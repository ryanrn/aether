"use client";

import { useState, useTransition } from "react";
import { requestPasswordResetAction } from "@/server/actions/password-reset";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input } from "@/components/ui/field";

/**
 * Pedido do link de redefinicao.
 *
 * A tela responde a MESMA coisa exista ou nao a conta — e isso e proposital,
 * nao descuido. Dizer "e-mail nao encontrado" transformaria esta pagina num
 * oraculo de quem tem conta aqui, util para montar lista de alvos.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [pendente, startTransition] = useTransition();

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    startTransition(async () => {
      const resultado = await requestPasswordResetAction(email);
      if (resultado.ok) setEnviado(true);
      else setErro(resultado.error);
    });
  }

  if (enviado) {
    return (
      <div className="rounded-md border border-base-700 bg-base-900 p-4">
        <p className="text-[13px] font-medium text-ink-100">
          Se existir uma conta com esse e-mail, o link ja foi enviado.
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-400">
          Ele vale por 1 hora e so pode ser usado uma vez. Se nao chegar em
          alguns minutos, confira a caixa de spam — e verifique se digitou o
          mesmo e-mail que usou no cadastro.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <Field
        label="Seu e-mail"
        hint="Enviaremos um link para voce escolher uma senha nova."
      >
        <Input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(evento) => setEmail(evento.target.value)}
          placeholder="voce@exemplo.com"
          required
        />
      </Field>

      <FieldError>{erro}</FieldError>

      <Button type="submit" variant="primary" disabled={pendente}>
        {pendente ? "Enviando..." : "Enviar link"}
      </Button>
    </form>
  );
}
