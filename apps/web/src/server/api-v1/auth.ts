import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@aether/db";
import { resolveBotToken, type BotIdentity } from "@aether/access";
import { erroApi } from "./resposta";

/**
 * Autenticação da REST v1.
 *
 * `Authorization: Bearer aeb_...` -> identidade do bot, ou `401`. Toda a lógica
 * de "este token vale?" mora em `resolveBotToken` (`@aether/access`) — aqui só
 * tiramos o `Bearer ` e traduzimos a recusa em resposta HTTP.
 *
 * O `lastIpHash` é gravado AQUI (a camada REST tem o IP; `resolveBotToken`,
 * que também roda no gateway, não). Best-effort, não bloqueia.
 */
export async function autenticarBot(
  request: Request,
): Promise<BotIdentity | NextResponse> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : null;

  const identidade = token ? await resolveBotToken(token) : null;
  if (!identidade) return erroApi("unauthorized");

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip");
  if (ip && token) {
    const ipHash = createHash("sha256").update(ip).digest("hex").slice(0, 32);
    void prisma.botToken
      .updateMany({
        where: { tokenHash: createHash("sha256").update(token).digest("hex") },
        data: { lastIpHash: ipHash },
      })
      .catch(() => undefined);
  }

  return identidade;
}

/** Type guard: `autenticarBot` devolveu a identidade (e não um 401). */
export function ehIdentidade(v: BotIdentity | NextResponse): v is BotIdentity {
  return !(v instanceof NextResponse);
}
