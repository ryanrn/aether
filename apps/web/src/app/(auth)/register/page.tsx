import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Criar conta" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="font-brand text-2xl font-semibold tracking-[-0.005em] text-ink-100">
        Criar conta
      </h1>
      <p className="mt-1.5 text-sm text-ink-400">
        Grátis durante o beta. Leva menos de um minuto.
      </p>

      <div className="mt-7">
        <RegisterForm />
      </div>

      <p className="mt-5 text-center text-[13px] text-ink-400">
        Já tem conta?{" "}
        <Link
          href="/login"
          className="text-accent-300 transition-colors hover:text-accent-400"
        >
          Entrar
        </Link>
      </p>
    </>
  );
}
