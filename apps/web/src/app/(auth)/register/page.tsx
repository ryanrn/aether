import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Criar conta" };

export default function RegisterPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink-100">Criar conta</h1>
        <p className="mt-1 text-[13px] text-ink-400">
          Leva menos de um minuto.
        </p>
      </div>

      <RegisterForm />

      <p className="text-center text-[13px] text-ink-400">
        Ja tem conta?{" "}
        <Link
          href="/login"
          className="text-accent-400 transition-colors hover:text-accent-300"
        >
          Entrar
        </Link>
      </p>
    </div>
  );
}
