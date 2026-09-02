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
  // `disponivel` (a integracao esta configurada?) nao e sensivel e nao depende
  // de sessao — ajuda a diagnosticar "a secao nao aparece".
  const disponivel = spotifyConfigurado();

  const sessao = await getSession();
  if (!sessao) {
    return NextResponse.json({ disponivel, conta: null });
  }

  const conta = await estadoSpotify(sessao.user.id);
  return NextResponse.json({ disponivel, conta });
}
