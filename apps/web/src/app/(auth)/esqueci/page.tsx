import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Esqueci minha senha" };

export default function ForgotPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink-100">Esqueceu a senha?</h1>
        <p className="mt-1 text-[13px] text-ink-400">
          Diga o e-mail do cadastro e enviamos um link para escolher outra.
        </p>
      </div>

      <ForgotPasswordForm />

      <p className="text-center text-[13px] text-ink-400">
        Lembrou?{" "}
        <Link
          href="/login"
          className="text-accent-400 transition-colors hover:text-accent-300"
        >
          Voltar para o login
        </Link>
      </p>
    </div>
  );
}
