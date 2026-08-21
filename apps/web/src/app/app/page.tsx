import { redirect } from "next/navigation";
import { BRAND } from "@aether/shared";
import { getSession } from "@/server/auth/session";
import { listServersForUser } from "@/server/services/servers";
import { EmptyState } from "@/components/layout/empty-state";

/**
 * Entrada do app: manda direto para o primeiro servidor, ou mostra o estado
 * vazio quando o usuario ainda nao participa de nenhum.
 */
export default async function AppHomePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const servers = await listServersForUser(session.user.id);
  if (servers[0]) redirect(`/app/s/${servers[0].id}`);

  return (
    <EmptyState
      title={`Bem-vindo ao ${BRAND.name}, ${session.user.displayName}`}
      description="Voce ainda nao participa de nenhum servidor. Crie o seu ou entre com um codigo de convite pelo botao + na barra lateral."
    />
  );
}
