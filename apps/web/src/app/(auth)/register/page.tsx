import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/components/auth/register-form";
import { sanitizeNextPath } from "@/lib/next-path";

export const metadata: Metadata = { title: "Criar conta" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const destino =
    next && sanitizeNextPath(next) !== "/app" ? sanitizeNextPath(next) : "";
  const entrar = destino
    ? `/login?next=${encodeURIComponent(destino)}`
    : "/login";

  return (
    <>
      <h1 className="font-brand text-2xl font-semibold tracking-[-0.005em] text-ink-100">
        Criar conta
      </h1>
      <p className="mt-1.5 text-sm text-ink-400">
        Grátis durante o beta. Leva menos de um minuto.
      </p>

      <div className="mt-7">
        <RegisterForm next={destino} />
      </div>

      <p className="mt-5 text-center text-[13px] text-ink-400">
        Já tem conta?{" "}
        <Link
          href={entrar}
          className="text-accent-300 transition-colors hover:text-accent-400"
        >
          Entrar
        </Link>
      </p>
    </>
  );
}
