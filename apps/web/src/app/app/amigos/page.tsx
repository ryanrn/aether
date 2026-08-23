import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { listFriendships } from "@/server/services/friends";
import { FriendsScreen } from "@/components/friends/friends-screen";

/**
 * Tela de amigos.
 *
 * Fica FORA de `/app/s/[serverId]` porque amizade nao pertence a servidor
 * nenhum — e justamente o unico lugar do app onde duas pessoas se veem sem
 * dividir um servidor.
 *
 * O socket vem do `RealtimeProvider` do layout de `/app`, ja montado acima —
 * esta pagina NAO monta um proprio. Montar aqui foi o erro que derrubava a
 * chamada: cada troca de tela criava e destruia uma conexao, e destruir a
 * conexao tira a pessoa do canal de voz.
 *
 * A presenca dos amigos chega pela sala pessoal, em que o gateway coloca todo
 * socket no `connection` — nao depende de estar dentro de servidor nenhum.
 */
export default async function FriendsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const friendships = await listFriendships(session.user.id);

  return (
    <FriendsScreen friendships={friendships} />
  );
}
