import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { listServersForUser } from "@/server/services/servers";
import { countIncomingRequests } from "@/server/services/friends";
import { ServerRail } from "@/components/layout/server-rail";
import { QuickSwitcher } from "@/components/layout/quick-switcher";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { VoiceSession } from "@/components/realtime/voice-session";

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

  // As duas em paralelo: sao independentes, e em serie a casca do app
  // esperaria duas idas ao banco antes de renderizar qualquer coisa.
  const [servers, pendingRequests] = await Promise.all([
    listServersForUser(session.user.id),
    countIncomingRequests(session.user.id),
  ]);

  return (
    /**
     * O provedor e a sessao de midia moram AQUI, e nao no layout do servidor.
     *
     * Foi um bug real que ensinou isso: com eles la dentro, sair para a tela de
     * amigos desmontava tudo, o socket fechava, e o gateway tirava a pessoa do
     * canal de voz. Navegar encerrava a chamada — o que nao pode acontecer.
     *
     * Aqui em cima os dois atravessam toda navegacao dentro de `/app`.
     */
    <RealtimeProvider>
      <div className="flex h-full w-full overflow-hidden bg-base-950">
        <VoiceSession />
        {/*
          No layout do /app, e nao dentro de um servidor: o atalho tem de
          funcionar tambem na tela de amigos e numa conversa direta — que e
          justamente de onde mais se quer pular para outro lugar.
        */}
        <QuickSwitcher />
        <ServerRail servers={servers} pendingRequests={pendingRequests} />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </RealtimeProvider>
  );
}
