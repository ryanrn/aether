import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <>
      <h1 className="font-brand text-2xl font-semibold tracking-[-0.005em] text-ink-100">
        Bem-vindo de volta
      </h1>
      <p className="mt-1.5 text-sm text-ink-400">
        Entre para acessar seus servidores e canais.
      </p>

      <div className="mt-7">
        <LoginForm />
      </div>

      <p className="mt-5 flex items-center justify-between text-[13px] text-ink-400">
        <Link
          href="/esqueci"
          className="transition-colors hover:text-ink-200"
        >
          Esqueci minha senha
        </Link>
        <Link
          href="/register"
          className="text-accent-300 transition-colors hover:text-accent-400"
        >
          Criar conta
        </Link>
      </p>
    </>
  );
}
