import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { listServersForUser } from "@/server/services/servers";
import { WelcomeCard } from "@/components/servers/welcome-card";

/**
 * Entrada do app: manda direto para o primeiro servidor, ou mostra o estado
 * vazio quando o usuario ainda nao participa de nenhum.
 */
export default async function AppHomePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const servers = await listServersForUser(session.user.id);
  if (servers[0]) redirect(`/app/s/${servers[0].id}`);

  return <WelcomeCard displayName={session.user.displayName} />;
}
