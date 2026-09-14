import { prisma } from "@aether/db";
import { loadMemberAccess } from "@aether/access";
import type { ApiServer } from "@aether/shared";
import { autenticarBot, ehIdentidade } from "@/server/api-v1/auth";
import { limitarBot } from "@/server/api-v1/limite";
import { erroApi, okApi } from "@/server/api-v1/resposta";

/**
 * `GET /api/v1/servers/:serverId` — dados basicos do servidor.
 *
 * Bot nao instalado (sem `ServerMember`) -> `loadMemberAccess` nulo -> 404.
 * Nunca 403: nao revelamos que o servidor existe para quem nao pertence.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ serverId: string }> },
): Promise<Response> {
  const bot = await autenticarBot(request);
  if (!ehIdentidade(bot)) return bot;

  const { serverId } = await ctx.params;

  const limite = await limitarBot({
    applicationId: bot.applicationId,
    serverId,
    escrita: false,
  });
  if (limite.bloqueado) return limite.bloqueado;

  const acesso = await loadMemberAccess(serverId, bot.botUserId);
  if (!acesso) return erroApi("not_found");

  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { id: true, name: true, iconUrl: true },
  });
  if (!server) return erroApi("not_found");

  const corpo: ApiServer = server;
  return okApi(corpo, 200, limite.headers);
}
