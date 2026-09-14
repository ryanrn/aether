import { prisma } from "@aether/db";
import { getChannelPermissionMap, loadMemberAccess } from "@aether/access";
import { has, type ApiChannel } from "@aether/shared";
import { autenticarBot, ehIdentidade } from "@/server/api-v1/auth";
import { limitarBot } from "@/server/api-v1/limite";
import { erroApi, okApi } from "@/server/api-v1/resposta";

/**
 * `GET /api/v1/servers/:serverId/channels` — os canais que o BOT enxerga.
 *
 * A mesma regra da arvore de canais na tela: `getChannelPermissionMap` +
 * `VIEW_CHANNEL`. Canal privado que o cargo do bot nao alcanca nem aparece na
 * lista.
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

  const [permissoes, canais] = await Promise.all([
    getChannelPermissionMap(acesso),
    prisma.channel.findMany({
      where: { serverId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        type: true,
        topic: true,
        position: true,
        categoryId: true,
      },
    }),
  ]);

  const visiveis: ApiChannel[] = canais.filter((c) =>
    has(permissoes.get(c.id) ?? 0n, "VIEW_CHANNEL"),
  );

  return okApi(visiveis, 200, limite.headers);
}
