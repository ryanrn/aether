import { NextResponse } from "next/server";
import { listarConexoes, provedoresConhecidos } from "@aether/access";
import { getSession } from "@/server/auth/session";

/**
 * Tudo o que a aba "Apps conectados" precisa, numa chamada.
 *
 * ROTA e nao dado do servidor no `AppSettingsModal` porque o modal e client e
 * vive fundo na arvore — puxar isto ate la seria threading de prop por varios
 * niveis. A aba busca sozinha ao montar e a cada foco da janela (a volta do
 * OAuth acontece fora do app).
 *
 * `provedores` nao depende de sessao e nao e sensivel — ajuda a diagnosticar
 * "a integracao nao aparece" (codigo pronto? segredo no ambiente?).
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const provedores = provedoresConhecidos();

  const sessao = await getSession();
  if (!sessao) {
    return NextResponse.json({ provedores, conexoes: [] });
  }

  const conexoes = await listarConexoes(sessao.user.id);
  return NextResponse.json({ provedores, conexoes });
}
