import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import {
  appParaInstalar,
  servidoresGerenciados,
} from "@/server/services/instalacao";
import { AuthorizeView } from "@/components/developer/authorize-view";

/**
 * `/app/authorize?app=<applicationId>` — o humano instala um bot num servidor.
 *
 * Fica sob `/app` de proposito: o middleware ja manda para o login e volta.
 * A pagina so mostra a previa (app + servidores onde a pessoa manda); a
 * autorizacao de verdade e a `instalarBotAction` (`requirePermission`
 * MANAGE_SERVER). O link nunca e bypass.
 */
export const metadata: Metadata = {
  title: "Autorizar aplicativo",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<{ app?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login?next=/app/authorize");

  const { app: appId } = await searchParams;

  const app = appId ? await appParaInstalar(appId) : null;
  if (!app) {
    return (
      <Erro texto="Este link de instalação está incompleto ou o aplicativo não está disponível." />
    );
  }

  const servidores = await servidoresGerenciados(session.user.id, app.id);

  return (
    <AuthorizeView
      app={{
        id: app.id,
        name: app.name,
        descricao: app.descricao,
        avatarUrl: app.avatarUrl,
      }}
      servidores={servidores}
    />
  );
}

function Erro({ texto }: { texto: string }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-[420px] rounded-xl border border-line bg-base-850 p-6 text-center">
        <p className="font-brand text-lg font-semibold text-ink-100">
          Não deu para continuar
        </p>
        <p className="mt-2 text-[13px] text-ink-400">{texto}</p>
      </div>
    </div>
  );
}
