import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { listServersForUser } from "@/server/services/servers";
import { ServerRail } from "@/components/layout/server-rail";

/**
 * Casca do aplicativo. Roda no servidor: a lista de servidores ja chega
 * renderizada e o cliente nao precisa de nenhuma chamada extra na primeira carga.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const servers = await listServersForUser(session.user.id);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-base-950">
      <ServerRail servers={servers} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
