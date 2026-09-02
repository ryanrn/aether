import { NextResponse } from "next/server";
import { estadoSpotify, spotifyConfigurado } from "@aether/access";
import { getSession } from "@/server/auth/session";

/**
 * Estado da conta do Spotify da pessoa, para a aba Atividade das configuracoes.
 *
 * ROTA e nao dado do servidor no `AppSettingsModal` porque o modal e client e
 * vive fundo na arvore — puxar isto ate la seria threading de prop por varios
 * niveis. A aba busca sozinha ao montar.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const sessao = await getSession();
  if (!sessao) {
    return NextResponse.json({ error: "Nao encontrado" }, { status: 404 });
  }

  const conta = await estadoSpotify(sessao.user.id);
  return NextResponse.json({
    disponivel: spotifyConfigurado(),
    conta, // null quando nao conectou
  });
}
