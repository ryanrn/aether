import { NextResponse } from "next/server";
import {
  buscarPerfil,
  guardarConta,
  trocarCodigo,
  verificarState,
} from "@aether/access";
import { getSession } from "@/server/auth/session";

/**
 * Volta da autorizacao do Spotify: troca o `code` pelos tokens, cifra e guarda.
 *
 * O `state` e conferido contra o usuario da SESSAO ATUAL: um code roubado nao
 * serve porque quem completa o fluxo precisa estar logado como a mesma pessoa
 * que comecou.
 *
 * Sempre termina com um redirect de volta para as configuracoes (aba
 * Atividade), com `?spotify=ok` ou `?spotify=erro` — a tela mostra o resultado.
 */
export const dynamic = "force-dynamic";

function voltar(origin: string, resultado: "ok" | "erro" | "negado"): Response {
  return NextResponse.redirect(`${origin}/app?spotify=${resultado}`);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;

  const sessao = await getSession();
  if (!sessao) return NextResponse.redirect(`${origin}/login`);

  // A pessoa clicou em "Cancelar" na tela da Spotify.
  if (url.searchParams.get("error")) return voltar(origin, "negado");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return voltar(origin, "erro");

  const dono = await verificarState(state);
  if (dono !== sessao.user.id) return voltar(origin, "erro");

  try {
    const redirectUri = `${origin}/api/spotify/callback`;
    const tokens = await trocarCodigo(code, redirectUri);
    const { displayName } = await buscarPerfil(tokens.accessToken).catch(() => ({
      displayName: null,
    }));
    await guardarConta({ userId: sessao.user.id, tokens, spotifyName: displayName });
    return voltar(origin, "ok");
  } catch {
    return voltar(origin, "erro");
  }
}
