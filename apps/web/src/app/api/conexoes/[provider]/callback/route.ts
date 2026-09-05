import { NextResponse } from "next/server";
import { tratarCallbackDeConexao } from "@/server/conexoes/retorno";
import { lerProvedor } from "@/server/conexoes/provedor-da-url";

/** Volta do login de qualquer provedor. Ver `retorno.ts` para o passo a passo. */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const provider = lerProvedor((await ctx.params).provider);
  if (!provider) {
    return NextResponse.json({ error: "Nao encontrado" }, { status: 404 });
  }
  return tratarCallbackDeConexao(request, provider, provider.toLowerCase());
}
