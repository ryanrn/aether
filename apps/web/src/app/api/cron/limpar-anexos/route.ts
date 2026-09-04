import { timingSafeEqual } from "node:crypto";
import { limparAnexosOrfaos } from "@/server/services/anexos";

/**
 * Faxina diaria dos anexos orfaos (anexo autorizado que nunca virou mensagem).
 *
 * Disparada pelo Vercel Cron — a agenda esta em `vercel.json`. O Vercel manda
 * `Authorization: Bearer $CRON_SECRET` automaticamente QUANDO a env
 * `CRON_SECRET` existe no projeto; pode ser o mesmo valor do `AUTH_SECRET`,
 * mas o nome tem de ser esse (e o que o Vercel procura).
 *
 * Sem o segredo configurado a rota RECUSA tudo, em vez de ficar aberta: uma
 * rota que apaga dados nao pode depender de "ninguem vai achar a URL".
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Uma passada mexe em ate 200 objetos: uma chamada ao R2 e uma ao banco cada. */
export const maxDuration = 60;

function autorizado(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const esperado = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(esperado);
  // Comparacao em tempo constante: igualdade simples vaza o segredo pelo tempo.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<Response> {
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { ok: false, erro: "CRON_SECRET nao configurado" },
      { status: 503 },
    );
  }
  if (!autorizado(request)) {
    return new Response("Nao autorizado", { status: 401 });
  }

  const resultado = await limparAnexosOrfaos();
  return Response.json({ ok: true, ...resultado });
}
