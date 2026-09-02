import { NextResponse } from "next/server";
import {
  assinarState,
  spotifyConfigurado,
  urlDeAutorizacao,
} from "@aether/access";
import { getSession } from "@/server/auth/session";

/**
 * Comeca o OAuth do Spotify: assina um `state` amarrado ao usuario e manda o
 * navegador para a tela de autorizacao da Spotify.
 *
 * ROTA e nao action porque termina num `redirect` para outro dominio, coisa
 * que Server Action nao faz. O `redirect_uri` e derivado da origem desta
 * requisicao — em producao bate com a URL registrada no painel do Spotify;
 * em dev com `http://127.0.0.1:3000/...`.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const sessao = await getSession();
  if (!sessao) {
    // 404, nao 401 — regra do projeto de nao revelar recurso.
    return NextResponse.json({ error: "Nao encontrado" }, { status: 404 });
  }
  if (!spotifyConfigurado()) {
    return NextResponse.json(
      { error: "Integracao com o Spotify nao configurada." },
      { status: 503 },
    );
  }

  const redirectUri = `${new URL(request.url).origin}/api/spotify/callback`;
  const state = await assinarState(sessao.user.id);
  return NextResponse.redirect(urlDeAutorizacao(redirectUri, state));
}
