import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { listarVitrine } from "@/server/services/descoberta";
import { ExplorarComunidades } from "@/components/descoberta/explorar-comunidades";

/**
 * Explorar comunidades.
 *
 * Fica FORA de `/app/s/[serverId]` pela mesma razao da tela de amigos: e o
 * lugar de encontrar servidores dos quais voce ainda nao faz parte, e estar
 * dentro de um servidor para procurar outro nao faria sentido nenhum.
 *
 * A primeira lista vem do SERVIDOR, ja renderizada. Sem isso, abrir a vitrine
 * mostraria uma grade vazia por um instante antes de a busca do cliente
 * responder — e vitrine que pisca vazia parece vitrine sem nada.
 */
export const metadata = { title: "Explorar comunidades" };

export default async function ExplorarPage() {
  const sessao = await getSession();
  if (!sessao) redirect("/login");

  const comunidades = await listarVitrine(sessao.user.id);

  return <ExplorarComunidades inicial={comunidades} />;
}
