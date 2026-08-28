import { redirect } from "next/navigation";
import { loadPlan } from "@aether/access";
import { getSession } from "@/server/auth/session";
import { PremiumShowcaseScreen } from "@/components/premium";

/**
 * A pagina do VIP.
 *
 * Fica FORA de `/app/s/[serverId]` pelo mesmo motivo da tela de amigos:
 * assinatura e da PESSOA, nao de um servidor. Entrar nela a partir de um
 * servidor e sair no outro nao faria sentido nenhum.
 *
 * O PLANO ATUAL E LIDO NO SERVIDOR e desce pronto. A tela precisa dele para
 * duas coisas — mostrar o que a pessoa ja tem e nao oferecer o que ela ja
 * comprou — e buscar isso no cliente faria a pagina piscar "assine agora" para
 * quem ja assinou.
 */
export default async function VipPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const plano = await loadPlan(session.user.id);

  return (
    <PremiumShowcaseScreen
      tierAtual={plano.tier}
      expiraEm={plano.expiraEm ? plano.expiraEm.toISOString() : null}
    />
  );
}
