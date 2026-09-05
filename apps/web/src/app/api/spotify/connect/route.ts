import { iniciarLogin, ProvedorNaoConfigurado } from "@aether/access";
import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";

/**
 * Comeca o OAuth do Spotify.
 *
 * ROTA e nao action porque termina num `redirect` para outro dominio, coisa
 * que Server Action nao faz. O `redirect_uri` e derivado da origem desta
 * requisicao — em producao bate com a URL registrada no painel do Spotify;
 * em dev, com `http://127.0.0.1:3000/...`.
 *
 * Mantem endereco proprio pela mesma razao do callback: o `redirect_uri`
 * registrado no painel do Spotify aponta para `/api/spotify/callback`.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const sessao = await getSession();
  if (!sessao) {
    // 404, nao 401 — regra do projeto de nao revelar recurso.
    return NextResponse.json({ error: "Nao encontrado" }, { status: 404 });
  }

  const redirectUri = `${new URL(request.url).origin}/api/spotify/callback`;
  try {
    return NextResponse.redirect(
      await iniciarLogin(sessao.user.id, "SPOTIFY", redirectUri),
    );
  } catch (e) {
    if (e instanceof ProvedorNaoConfigurado) {
      return NextResponse.json(
        { error: "Integracao com o Spotify nao configurada." },
        { status: 503 },
      );
    }
    throw e;
  }
}
