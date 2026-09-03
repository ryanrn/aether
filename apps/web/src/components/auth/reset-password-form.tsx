"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  checkResetTokenAction,
  resetPasswordAction,
} from "@/server/actions/password-reset";
import { Button } from "@/components/ui/button";
import { Field, FieldError, Input } from "@/components/ui/field";

/**
 * Escolha da senha nova, a partir do link do e-mail.
 *
 * O token e conferido ao abrir, ANTES de mostrar o formulario: descobrir que
 * o link venceu depois de digitar a senha duas vezes seria gratuito.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const [estado, setEstado] = useState<"conferindo" | "valido" | "invalido">(
    "conferindo",
  );
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);
  const [pendente, startTransition] = useTransition();

  useEffect(() => {
    void checkResetTokenAction(token).then((resultado) => {
      setEstado(resultado.ok && resultado.data.valido ? "valido" : "invalido");
    });
  }, [token]);

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    // Confere aqui so por conveniencia; o servidor valida a senha de novo.
    if (senha !== confirma) {
      setErro("As duas senhas nao sao iguais.");
      return;
    }
    startTransition(async () => {
      const resultado = await resetPasswordAction(token, senha);
      if (resultado.ok) setPronto(true);
      else setErro(resultado.error);
    });
  }

  if (estado === "conferindo") {
    return <p className="text-[13px] text-ink-400">Conferindo o link...</p>;
  }

  if (estado === "invalido") {
    return (
      <div className="rounded-md border border-line bg-base-900 p-4">
        <p className="text-[13px] font-medium text-ink-100">
          Este link nao vale mais.
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-400">
          Links de redefinicao valem por 1 hora e servem uma vez so. Peca um
          novo para continuar.
        </p>
        <Link
          href="/esqueci"
          className="mt-3 inline-block text-[13px] text-accent-400 transition-colors hover:text-accent-300"
        >
          Pedir um link novo
        </Link>
      </div>
    );
  }

  if (pronto) {
    return (
      <div className="rounded-md border border-line bg-base-900 p-4">
        <p className="text-[13px] font-medium text-ink-100">Senha alterada.</p>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-400">
          Por seguranca, todas as sessoes abertas dessa conta foram encerradas —
          inclusive em outros aparelhos. Entre de novo com a senha nova.
        </p>
        <Link
          href="/login"
          className="mt-3 inline-block text-[13px] text-accent-400 transition-colors hover:text-accent-300"
        >
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <Field label="Senha nova">
        <Input
          type="password"
          autoComplete="new-password"
          value={senha}
          onChange={(evento) => setSenha(evento.target.value)}
          required
        />
      </Field>

      <Field label="Repita a senha nova">
        <Input
          type="password"
          autoComplete="new-password"
          value={confirma}
          onChange={(evento) => setConfirma(evento.target.value)}
          required
        />
      </Field>

      <FieldError>{erro}</FieldError>

      <Button type="submit" variant="primary" disabled={pendente}>
        {pendente ? "Salvando..." : "Salvar senha nova"}
      </Button>
    </form>
  );
}
