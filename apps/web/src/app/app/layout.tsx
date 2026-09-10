import { redirect } from "next/navigation";
import { precisaVerificarEmail } from "@aether/access";
import { precisaAceitarTermos } from "@aether/shared";
import { getSession } from "@/server/auth/session";
import { listServersForUser } from "@/server/services/servers";
import { countIncomingRequests } from "@/server/services/friends";
import { ServerRail } from "@/components/layout/server-rail";
import { HomeNavPanel } from "@/components/layout/home-nav-panel";
import { QuickSwitcher } from "@/components/layout/quick-switcher";
import { NavBackdrop } from "@/components/layout/nav-mobile";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { VoiceSession } from "@/components/realtime/voice-session";
import { AparenciaProvider } from "@/components/ui/aparencia";
import { ParedeDeVerificacao } from "@/components/auth/parede-de-verificacao";
import { AceiteDeTermos } from "@/components/auth/aceite-de-termos";

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

  /**
   * Parede de confirmacao de e-mail. Vem ANTES de carregar servidores/amigos —
   * quem nao confirmou nao ve nada do app, entao nem gastamos as consultas.
   * `precisaVerificarEmail` ja considera a flag `exige_email_verificado` e
   * isenta a equipe.
   */
  if (await precisaVerificarEmail(session.user)) {
    return <ParedeDeVerificacao email={session.user.email} />;
  }

  /**
   * (Re)aceite dos Termos. Renderizado SOBRE o app (nao no lugar dele) — a
   * pessoa ja confirmou o e-mail e a diferenca aqui costuma ser so uma versao
   * nova de texto, entao carregar a casca por baixo e ok. Ainda bloqueia: o
   * modal cobre a tela e so aceita ou sai.
   */
  const precisaTermos = precisaAceitarTermos(session.user);

  // As duas em paralelo: sao independentes, e em serie a casca do app
  // esperaria duas idas ao banco antes de renderizar qualquer coisa.
  const [servers, pendingRequests] = await Promise.all([
    listServersForUser(session.user.id),
    countIncomingRequests(session.user.id),
  ]);

  // `email` fica no servidor — o menu da trilha nao precisa dele.
  const { email: _email, ...railUser } = session.user;

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
      <AparenciaProvider />
      <div className="flex h-full w-full overflow-hidden bg-base-950">
        {precisaTermos ? (
          <AceiteDeTermos atualizados={session.user.aceitouTermosEm !== null} />
        ) : null}
        <VoiceSession />
        {/*
          No layout do /app, e nao dentro de um servidor: o atalho tem de
          funcionar tambem na tela de amigos e numa conversa direta — que e
          justamente de onde mais se quer pular para outro lugar.
        */}
        <QuickSwitcher />
        {/*
          O fundo da gaveta do celular. No layout de `/app` para cobrir
          qualquer tela — canal, conversa ou amigos — e nao so uma delas.
        */}
        <NavBackdrop />
        <ServerRail
          servers={servers}
          user={railUser}
          pendingRequests={pendingRequests}
        />
        {/*
          A "home" (Amigos, Loja, Grupos, Olimpo, Explorar, painel da equipe e
          as conversas diretas). So aparece fora de um servidor — ele proprio
          decide pela rota. Dentro de `/app/s/[serverId]` quem ocupa esta coluna
          e a arvore de canais.
        */}
        <HomeNavPanel
          pendingRequests={pendingRequests}
          equipe={session.user.equipe}
        />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </RealtimeProvider>
  );
}
