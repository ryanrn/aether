import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink-100">Bem-vindo de volta</h1>
        <p className="mt-1 text-[13px] text-ink-400">
          Entre para acessar seus servidores e canais.
        </p>
      </div>

      <LoginForm />

      <p className="text-center text-[13px]">
        <Link
          href="/esqueci"
          className="text-ink-400 transition-colors hover:text-ink-200"
        >
          Esqueci minha senha
        </Link>
      </p>

      <p className="text-center text-[13px] text-ink-400">
        Ainda nao tem conta?{" "}
        <Link
          href="/register"
          className="text-accent-400 transition-colors hover:text-accent-300"
        >
          Criar conta
        </Link>
      </p>
    </div>
  );
}
