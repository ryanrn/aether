import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { carregarApp } from "@/server/services/aplicativos";
import { AppDetail } from "@/components/developer/app-detail";

export const metadata: Metadata = { title: "Aplicativo — Developer Portal" };
export const dynamic = "force-dynamic";

export default async function AppPage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login?next=/app/developers");

  const { appId } = await params;
  const app = await carregarApp(appId, session.user.id);
  if (!app) notFound();

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const linkInstalacao = `${base.replace(/\/+$/, "")}/app/authorize?app=${app.id}`;

  return <AppDetail app={app} linkInstalacao={linkInstalacao} />;
}
