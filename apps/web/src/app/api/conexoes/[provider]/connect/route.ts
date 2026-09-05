import { iniciarLogin, ProvedorNaoConfigurado } from "@aether/access";
import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { lerProvedor } from "@/server/conexoes/provedor-da-url";

/**
 * Comeca o login de QUALQUER provedor: `/api/conexoes/twitch/connect`.
 *
 * Uma rota para todos. O Spotify tem endereco proprio por causa do
 * `redirect_uri` ja registrado no painel dele — provedores novos entram por
 * aqui e nao criam arquivo nenhum.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const sessao = await getSession();
  // 404, nao 401 — regra do projeto de nao revelar recurso.
  if (!sessao) {
    return NextResponse.json({ error: "Nao encontrado" }, { status: 404 });
  }

  const provider = lerProvedor((await ctx.params).provider);
  if (!provider) {
    return NextResponse.json({ error: "Nao encontrado" }, { status: 404 });
  }

  const origin = new URL(request.url).origin;
  try {
    return NextResponse.redirect(
      await iniciarLogin(
        sessao.user.id,
        provider,
        `${origin}/api/conexoes/${provider.toLowerCase()}/callback`,
      ),
    );
  } catch (e) {
    if (e instanceof ProvedorNaoConfigurado) {
      return NextResponse.json(
        { error: "Integracao nao configurada." },
        { status: 503 },
      );
    }
    throw e;
  }
}
