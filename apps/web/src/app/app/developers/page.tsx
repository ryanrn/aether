import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { listarMinhasApps } from "@/server/services/aplicativos";
import { AppsList } from "@/components/developer/apps-list";

/**
 * `/app/developers` — a lista de aplicativos do desenvolvedor.
 *
 * Portal proprio: nao usa o painel "home" (Amigos/Loja) — so a trilha fina de
 * servidores da casca do `/app`. Estrutura no estilo do Discord Developer
 * Portal: lista -> abrir um app -> abas (Informacoes gerais / Bot / Instalacao).
 */
export const metadata: Metadata = { title: "Developer Portal" };
export const dynamic = "force-dynamic";

export default async function DevelopersPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/app/developers");

  const apps = await listarMinhasApps(session.user.id);

  return <AppsList apps={apps} />;
}
