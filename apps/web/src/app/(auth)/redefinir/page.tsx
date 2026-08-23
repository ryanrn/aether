import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Redefinir senha" };

/**
 * O token vem na URL, e por isso esta pagina NAO e indexavel nem cacheavel.
 * `dynamic` garante que o Next nao tente pre-renderizar algo que depende de
 * um segredo por visitante.
 */
export const dynamic = "force-dynamic";

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink-100">Nova senha</h1>
        <p className="mt-1 text-[13px] text-ink-400">
          Escolha uma senha que voce nao use em outro lugar.
        </p>
      </div>

      <ResetPasswordForm token={token ?? ""} />
    </div>
  );
}
