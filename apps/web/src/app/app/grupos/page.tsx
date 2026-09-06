import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import {
  listarGruposDosMeusServidores,
  servidoresParaGrupo,
} from "@/server/services/grupos";
import { GruposScreen } from "@/components/grupos/grupos-screen";

/**
 * Grupos (LFG) — fase 2, estagio 4a.
 *
 * FORA de `/app/s/[serverId]` pela mesma razao de Amigos e Explorar: e onde
 * voce acha gente pra jogar ATRAVESSANDO servidores, e estar dentro de um pra
 * isso nao faria sentido.
 *
 * A lista vem RENDERIZADA do servidor; a tela so acrescenta o auto-refresh (nao
 * ha socket ao vivo para salas de servidores que voce nao abriu).
 */
export const metadata = { title: "Grupos" };

export default async function GruposPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [grupos, servidores] = await Promise.all([
    listarGruposDosMeusServidores(session.user.id),
    servidoresParaGrupo(session.user.id),
  ]);

  return (
    <GruposScreen
      inicial={grupos}
      servidores={servidores}
      selfUserId={session.user.id}
    />
  );
}
