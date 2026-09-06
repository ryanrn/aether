import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Esqueci minha senha" };

export default function ForgotPage() {
  return (
    <>
      <h1 className="font-brand text-2xl font-semibold tracking-[-0.005em] text-ink-100">
        Esqueceu a senha?
      </h1>
      <p className="mt-1.5 text-sm text-ink-400">
        Diga o e-mail do cadastro e enviamos um link para escolher outra.
      </p>

      <div className="mt-7">
        <ForgotPasswordForm />
      </div>

      <p className="mt-5 text-center text-[13px] text-ink-400">
        Lembrou?{" "}
        <Link
          href="/login"
          className="text-accent-300 transition-colors hover:text-accent-400"
        >
          Voltar para o login
        </Link>
      </p>
    </>
  );
}
