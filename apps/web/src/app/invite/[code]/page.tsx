import { redirect } from "next/navigation";
import Link from "next/link";
import { inviteCodeSchema } from "@aether/shared";
import { getSession } from "@/server/auth/session";
import { joinServerByCode } from "@/server/services/invites";

/**
 * Link direto de convite: /invite/<codigo>.
 * Sem sessao, manda para o login preservando o destino.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const parsed = inviteCodeSchema.safeParse(code);

  const session = await getSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${code}`)}`);
  }

  if (!parsed.success) {
    return <InviteError message="Codigo de convite invalido." />;
  }

  const result = await joinServerByCode(session.user.id, parsed.data);
  if (!result.ok) {
    return <InviteError message={result.error} />;
  }

  redirect(`/app/s/${result.data.serverId}`);
}

function InviteError({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-[380px] rounded-lg border border-base-700 bg-base-850 p-6 text-center">
        <h1 className="text-sm font-semibold text-ink-100">Convite indisponivel</h1>
        <p className="mt-2 text-[13px] text-ink-400">{message}</p>
        <Link
          href="/app"
          className="mt-5 inline-block text-[13px] text-accent-400 transition-colors hover:text-accent-300"
        >
          Voltar para o app
        </Link>
      </div>
    </div>
  );
}
