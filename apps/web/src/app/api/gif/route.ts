import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import {
  buscarGifs,
  categoriasDeGif,
  gifDisponivel,
  gifsEmAlta,
} from "@/server/services/gif";

/**
 * Proxy do Giphy. O navegador nunca fala com a API do Giphy direto — a chave
 * mora aqui. `?tipo=busca&q=...&pos=...`, `?tipo=alta&pos=...`,
 * `?tipo=categorias`.
 *
 * EXIGE SESSAO (404 se nao, como o resto). Sem `GIPHY_API_KEY` a rota responde
 * `{ disponivel: false }` e o seletor de GIF mostra "em breve".
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sessao = await getSession();
  if (!sessao) {
    return NextResponse.json({ error: "Nao encontrado" }, { status: 404 });
  }

  if (!gifDisponivel()) {
    return NextResponse.json({ disponivel: false });
  }

  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo") ?? "alta";
  const pos = url.searchParams.get("pos");
  const q = url.searchParams.get("q")?.trim() ?? "";

  try {
    if (tipo === "categorias") {
      return NextResponse.json({
        disponivel: true,
        categorias: await categoriasDeGif(),
      });
    }
    if (tipo === "busca" && q) {
      return NextResponse.json({
        disponivel: true,
        ...(await buscarGifs(q, pos)),
      });
    }
    return NextResponse.json({
      disponivel: true,
      ...(await gifsEmAlta(pos)),
    });
  } catch (erro) {
    console.error("gif proxy falhou", erro);
    return NextResponse.json(
      { disponivel: true, resultados: [], proximaPos: null, erro: true },
      { status: 502 },
    );
  }
}
