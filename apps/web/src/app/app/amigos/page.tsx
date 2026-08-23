import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { listFriendships } from "@/server/services/friends";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { FriendsScreen } from "@/components/friends/friends-screen";

/**
 * Tela de amigos.
 *
 * Fica FORA de `/app/s/[serverId]` porque amizade nao pertence a servidor
 * nenhum — e justamente o unico lugar do app onde duas pessoas se veem sem
 * dividir um servidor.
 *
 * O `RealtimeProvider` e montado aqui com `serverId={null}`: o socket abre e
 * entra na sala pessoal (o gateway faz isso sozinho, no `connection`), o que
 * traz a presenca dos amigos. Nao ha `server:join`, porque nao ha servidor.
 *
 * Sao dois provedores no app, nunca ao mesmo tempo: esta rota e a de servidor
 * sao irmas, entao so uma esta montada — nao ha dois sockets abertos.
 */
export default async function FriendsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const friendships = await listFriendships(session.user.id);

  return (
    <RealtimeProvider serverId={null}>
      <FriendsScreen friendships={friendships} />
    </RealtimeProvider>
  );
}
