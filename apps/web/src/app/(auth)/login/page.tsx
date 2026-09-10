import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { sanitizeNextPath } from "@/lib/next-path";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // `""` quando nao ha destino valido — o form omite o campo e a action cai
  // no padrao `/app`.
  const destino =
    next && sanitizeNextPath(next) !== "/app" ? sanitizeNextPath(next) : "";
  const registro = destino
    ? `/register?next=${encodeURIComponent(destino)}`
    : "/register";

  return (
    <>
      <h1 className="font-brand text-2xl font-semibold tracking-[-0.005em] text-ink-100">
        Bem-vindo de volta
      </h1>
      <p className="mt-1.5 text-sm text-ink-400">
        Entre para acessar seus servidores e canais.
      </p>

      <div className="mt-7">
        <LoginForm next={destino} />
      </div>

      <p className="mt-5 flex items-center justify-between text-[13px] text-ink-400">
        <Link
          href="/esqueci"
          className="transition-colors hover:text-ink-200"
        >
          Esqueci minha senha
        </Link>
        <Link
          href={registro}
          className="text-accent-300 transition-colors hover:text-accent-400"
        >
          Criar conta
        </Link>
      </p>
    </>
  );
}
